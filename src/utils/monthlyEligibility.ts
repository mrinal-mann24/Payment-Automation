import type { HubspotLineItem, VaDealWithLineItems } from "../clients/hubspot.js";

// How a deal is billed, decided from the latest line item's Term alone
// (HubSpot's hs_recurring_billing_period, e.g. P1M / P3M / P6M). The
// deal-level Billing Cycle field and the frequency label are ignored: the
// line item is what the team records for every payment, the deal field is
// stale on several live deals.
//
//   monthly      P1M  — calendar-month cycle, quoted on the 1st at the
//                       client_pricing base price
//   term         P3M / P6M — quoted the day the last term ends, for the
//                       same length again, at what the client paid last time
//   unsupported  any other term (e.g. P7M) — nothing bills it automatically
//   none         yearly, no usable term, no dated line item, unreadable —
//                       left to the legacy due-date flow
export type DealClassification =
  | { kind: "monthly"; due: true; latest: HubspotLineItem }
  | { kind: "monthly"; due: false; reason: string; latest: HubspotLineItem }
  | { kind: "term"; months: 3 | 6; due: true; periodStart: string; lastPaid: number; latest: HubspotLineItem }
  | {
      kind: "term";
      months: 3 | 6;
      due: false;
      reason: string;
      periodStart: string;
      lastPaid: number;
      latest: HubspotLineItem;
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "none"; reason: string };

// HubSpot's Term is an ISO-8601 duration in whole months or years.
export function termMonths(term: string | null | undefined): number | null {
  const match = /^P(\d+)([MY])$/.exec(term ?? "");
  if (!match) {
    return null;
  }
  return Number(match[1]) * (match[2] === "Y" ? 12 : 1);
}

// `today` is the IST date (YYYY-MM-DD) of the tick or request. HubSpot's
// billing end date is exclusive, so a term ending today is due today and a
// monthly item ending on the 1st means that month is not yet billed.
export function classifyDeal(
  deal: Pick<VaDealWithLineItems, "lineItems" | "lineItemsError">,
  today: string,
): DealClassification {
  if (deal.lineItemsError) {
    return { kind: "none", reason: `line items could not be read: ${deal.lineItemsError}` };
  }

  const dated = deal.lineItems.filter((item) => item.billingTermEndDate);
  if (dated.length === 0) {
    return { kind: "none", reason: "no line item has a billing end date" };
  }

  const latestEnd = dated.reduce(
    (max, item) => (item.billingTermEndDate! > max ? item.billingTermEndDate! : max),
    "",
  );
  const latestItems = dated.filter((item) => item.billingTermEndDate === latestEnd);
  const latest = latestItems[0]!;
  if (latestItems.some((item) => (item.billingPeriodTerm ?? "") !== (latest.billingPeriodTerm ?? ""))) {
    return { kind: "none", reason: `latest line items (ending ${latestEnd}) disagree on term` };
  }

  const term = latest.billingPeriodTerm ?? "not set";
  const months = termMonths(latest.billingPeriodTerm);
  if (months === null) {
    return { kind: "none", reason: `latest line item has no usable term (${term})` };
  }

  if (months === 1) {
    const monthStart = `${today.slice(0, 7)}-01`;
    if (latestEnd > monthStart) {
      return { kind: "monthly", due: false, reason: `already billed through ${latestEnd}`, latest };
    }
    return { kind: "monthly", due: true, latest };
  }

  if (months === 3 || months === 6) {
    const base = {
      kind: "term" as const,
      months: months as 3 | 6,
      periodStart: latestEnd,
      lastPaid: latest.price * latest.quantity,
      latest,
    };
    if (latestEnd > today) {
      return { ...base, due: false, reason: `next term starts ${latestEnd}` };
    }
    return { ...base, due: true };
  }

  if (months % 12 === 0) {
    return { kind: "none", reason: `yearly term (${term}) is left to the due-date flow` };
  }
  return {
    kind: "unsupported",
    reason: `latest line item term is ${term} (${months} months); only 1, 3 or 6 month terms are billed automatically`,
  };
}
