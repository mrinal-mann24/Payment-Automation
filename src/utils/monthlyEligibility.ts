import type { HubspotLineItem, VaDealWithLineItems } from "../clients/hubspot.js";

export type DealClassification =
  | { monthly: true; due: true; latest: HubspotLineItem }
  | { monthly: true; due: false; reason: string; latest: HubspotLineItem }
  | { monthly: false; reason: string };

function billingSignature(item: HubspotLineItem): string {
  return `${item.recurringBillingFrequency ?? "?"}/${item.billingPeriodTerm ?? "?"}`;
}

// A deal is billed monthly by this automation only when HubSpot agrees with
// itself: the deal-level billing_cycle says Monthly AND the latest line item
// (by billing end date) is monthly with a one-month term. Anything else —
// including a data mismatch or an unreadable line item — is left to the
// existing due-date flow, with the reason surfaced on the admin page.
// `monthStart` is the first day (YYYY-MM-DD) of the cycle being generated;
// HubSpot's billing end date is exclusive, so an item ending exactly on
// monthStart means that month is not yet billed.
export function classifyDeal(
  deal: Pick<VaDealWithLineItems, "billingCycle" | "lineItems" | "lineItemsError">,
  monthStart: string,
): DealClassification {
  if (deal.lineItemsError) {
    return { monthly: false, reason: `line items could not be read: ${deal.lineItemsError}` };
  }
  if (deal.billingCycle !== "Monthly") {
    const value = deal.billingCycle ? `"${deal.billingCycle}"` : "not set";
    return { monthly: false, reason: `deal billing_cycle is ${value}` };
  }

  const dated = deal.lineItems.filter((item) => item.billingTermEndDate);
  if (dated.length === 0) {
    return { monthly: false, reason: "no line item has a billing end date" };
  }

  const latestEnd = dated.reduce(
    (max, item) => (item.billingTermEndDate! > max ? item.billingTermEndDate! : max),
    "",
  );
  const latestItems = dated.filter((item) => item.billingTermEndDate === latestEnd);
  const latest = latestItems[0]!;
  if (latestItems.some((item) => billingSignature(item) !== billingSignature(latest))) {
    return { monthly: false, reason: `latest line items (ending ${latestEnd}) disagree on billing frequency` };
  }
  if (billingSignature(latest) !== "monthly/P1M") {
    return { monthly: false, reason: `latest line item is ${billingSignature(latest)}, not monthly/P1M` };
  }
  if (latestEnd > monthStart) {
    return { monthly: true, due: false, reason: `already billed through ${latestEnd}`, latest };
  }
  return { monthly: true, due: true, latest };
}
