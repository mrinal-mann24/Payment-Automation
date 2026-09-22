import type { HubspotLineItem, VaDealWithLineItems } from "../clients/hubspot.js";

export type CycleMonths = number; // 1–11: any whole number of months under a year

// How a deal is billed. The cycle length comes from the latest line item's
// Term (hs_recurring_billing_period); the date a client is quoted comes
// from the deal's Next Renewal Date, which the automation moves forward by
// the term after each payment. The deal-level Billing Cycle field and the
// line item's own dates play no part.
//
//   cycle        any term under a year (P1M, P3M, P6M, P7M …) — quoted on
//                the Next Renewal Date for that many months: monthly at the
//                client_pricing base price (amount null), longer terms at
//                what the client paid last time (latest price × quantity)
//   none         a year or longer, no usable term, no dated line item,
//                unreadable — left to the legacy due-date flow
export type DealClassification =
  | { kind: "cycle"; months: CycleMonths; due: true; periodStart: string; amount: number | null; latest: HubspotLineItem }
  | {
      kind: "cycle";
      months: CycleMonths;
      due: false;
      reason: string;
      periodStart: string | null;
      amount: number | null;
      latest: HubspotLineItem;
    }
  | { kind: "none"; reason: string };

// HubSpot's Term is an ISO-8601 duration in whole months or years.
export function termMonths(term: string | null | undefined): number | null {
  const match = /^P(\d+)([MY])$/.exec(term ?? "");
  if (!match) {
    return null;
  }
  return Number(match[1]) * (match[2] === "Y" ? 12 : 1);
}

export function cycleLabel(months: CycleMonths): string {
  return months === 1 ? "Monthly" : months === 3 ? "Quarterly" : months === 6 ? "Half-yearly" : `Every ${months} months`;
}

// HubSpot stores a cleared date field as 1970-01-01 on some deals.
function realDate(value: string | null): string | null {
  return value && value >= "2000-01-01" ? value : null;
}

// `today` is the IST date (YYYY-MM-DD) of the tick or request.
export function classifyDeal(
  deal: Pick<VaDealWithLineItems, "lineItems" | "lineItemsError" | "nextRenewalDate">,
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
  if (months >= 12) {
    return { kind: "none", reason: `yearly or longer term (${term}) is left to the due-date flow` };
  }

  const base = {
    kind: "cycle" as const,
    months,
    amount: months === 1 ? null : latest.price * latest.quantity,
    latest,
  };
  const next = realDate(deal.nextRenewalDate);
  if (!next) {
    return {
      ...base,
      due: false,
      periodStart: null,
      reason: deal.nextRenewalDate
        ? `Next Renewal Date ${deal.nextRenewalDate} is not a real date`
        : "no Next Renewal Date on the deal",
    };
  }
  if (next > today) {
    return { ...base, due: false, periodStart: next, reason: `next quote on ${next}` };
  }
  return { ...base, due: true, periodStart: next };
}
