import type { HubspotLineItem, VaDealWithLineItems } from "../clients/hubspot.js";

export type CycleMonths = number; // 1–11: any whole number of months under a year

// How a deal is billed. The cycle length comes from the latest line item's
// Term (hs_recurring_billing_period); the date a client is quoted comes
// from the deal's Next Renewal Date, which the automation moves forward by
// the term after each payment. The deal-level Billing Cycle field and the
// line item's own dates play no part.
//
//   cycle        any term under a year (P1M, P3M, P6M, P7M …) — quoted on
//                the Next Renewal Date for that many months, at the line
//                item's unit price × quantity; amount is null only when
//                the line item has no price, and the client_pricing base
//                price is then the fallback (decision 2026-09-28)
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

// The line item that times and prices a deal: the recurring one (it has a
// billing start date and a usable term) with the latest billing start
// date. One-time and undated items are ignored, however recent.
export function latestRecurringLineItem<T extends Pick<HubspotLineItem, "billingStartDate" | "billingPeriodTerm">>(
  lineItems: T[],
): T | null {
  let latest: T | null = null;
  for (const item of lineItems) {
    if (!item.billingStartDate || termMonths(item.billingPeriodTerm) === null) {
      continue;
    }
    if (latest === null || item.billingStartDate > latest.billingStartDate!) {
      latest = item;
    }
  }
  return latest;
}

// The accountant renews a client by cloning last cycle's line item;
// HubSpot appends " (Copy)" to the name each time and nobody renames it
// (decision 2026-09-29, after live data showed names like "All VA
// Services (Copy) (Copy) (Copy) (Copy) (Copy) (Copy)"). Strips a trailing
// run of that suffix before a name is used as the quote's line item name —
// but never down to nothing, so a name that is only "(Copy)" is left as is
// rather than sent blank.
export function cleanLineItemName(name: string): string;
export function cleanLineItemName(name: string | null): string | null;
export function cleanLineItemName(name: string | undefined): string | undefined;
export function cleanLineItemName(name: string | null | undefined): string | null | undefined {
  if (!name) {
    return name;
  }
  const stripped = name.replace(/(\s*\(Copy\))+$/, "").trim();
  return stripped || name;
}

// `today` is the IST date (YYYY-MM-DD) of the tick or request.
export function classifyDeal(
  deal: Pick<VaDealWithLineItems, "lineItems" | "lineItemsError" | "nextRenewalDate">,
  today: string,
): DealClassification {
  if (deal.lineItemsError) {
    return { kind: "none", reason: `line items could not be read: ${deal.lineItemsError}` };
  }

  const latest = latestRecurringLineItem(deal.lineItems);
  if (!latest) {
    const terms = [...new Set(deal.lineItems.filter((item) => item.billingStartDate).map((item) => item.billingPeriodTerm ?? "not set"))];
    return {
      kind: "none",
      reason: `no line item has a billing start date and a usable term${terms.length ? ` (terms seen: ${terms.join(", ")})` : ""}`,
    };
  }
  const sameStart = deal.lineItems.filter(
    (item) => item.billingStartDate === latest.billingStartDate && termMonths(item.billingPeriodTerm) !== null,
  );
  if (sameStart.some((item) => item.billingPeriodTerm !== latest.billingPeriodTerm)) {
    return { kind: "none", reason: `latest line items (starting ${latest.billingStartDate}) disagree on term` };
  }

  const term = latest.billingPeriodTerm ?? "not set";
  const termLength = termMonths(latest.billingPeriodTerm)!;
  // The quantity is a number of months too (decision 2026-09-22: a
  // monthly-term item with quantity 3 is a 3-month cycle); the team also
  // enters a 7-month term as P7M × 7, so the cycle is the longer of the two.
  const months = Math.max(termLength, latest.quantity);
  if (!Number.isInteger(months) || months < 1) {
    return { kind: "none", reason: `quantity ${latest.quantity} is not a whole number of months` };
  }
  if (months >= 12) {
    return {
      kind: "none",
      reason: `a year or longer (term ${term}, quantity ${latest.quantity}) is left to the due-date flow`,
    };
  }

  const base = {
    kind: "cycle" as const,
    months,
    amount: latest.price > 0 ? latest.price * latest.quantity : null,
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
