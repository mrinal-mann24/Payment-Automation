import { describe, expect, it } from "vitest";
import { classifyDeal, cycleLabel, termMonths } from "../utils/monthlyEligibility.js";
import type { HubspotLineItem } from "../clients/hubspot.js";

const item = (overrides: Partial<HubspotLineItem> = {}): HubspotLineItem => ({
  id: "li-1",
  name: "VA Monthly",
  quantity: 1,
  price: 5000,
  recurringBillingFrequency: "monthly",
  billingPeriodTerm: "P1M",
  billingStartDate: "2026-09-01",
  billingTermEndDate: "2026-10-01",
  recurringRevenueType: "Renewal",
  productId: "285430818522",
  ...overrides,
});

const quarterly = (overrides: Partial<HubspotLineItem> = {}): HubspotLineItem =>
  item({
    id: "li-q",
    recurringBillingFrequency: "quarterly",
    billingPeriodTerm: "P3M",
    billingStartDate: "2026-07-09",
    billingTermEndDate: "2026-10-09",
    price: 39000,
    ...overrides,
  });

// The cycle length comes from the latest line item's Term; the date a
// client is quoted comes from the deal's Next Renewal Date. The deal-level
// Billing Cycle field and the line item's own dates play no part.
const deal = (nextRenewalDate: string | null, lineItems: HubspotLineItem[]) => ({
  dealId: "deal-1",
  dealName: "Acme <> VA",
  dealStage: "3102360263",
  billingCycle: "Quarterly",
  nextRenewalDate,
  lineItems,
});

describe("termMonths", () => {
  it("reads HubSpot's ISO-8601 term as a number of months", () => {
    expect(["P1M", "P3M", "P6M", "P7M", "P12M", "P1Y"].map(termMonths)).toEqual([1, 3, 6, 7, 12, 12]);
    expect([null, undefined, "", "P1W", "monthly"].map(termMonths)).toEqual([null, null, null, null, null]);
  });
});

describe("cycleLabel", () => {
  it("names the cycle by its length", () => {
    expect([1, 3, 6, 7, 10].map(cycleLabel)).toEqual(["Monthly", "Quarterly", "Half-yearly", "Every 7 months", "Every 10 months"]);
  });
});

describe("classifyDeal — cycle from the line item term, date from the deal's Next Renewal Date", () => {
  it("a monthly client is due on their Next Renewal Date, priced from client_pricing (amount null)", () => {
    const result = classifyDeal(deal("2026-10-01", [item()]), "2026-10-01");
    expect(result).toEqual({ kind: "cycle", months: 1, due: true, periodStart: "2026-10-01", amount: null, latest: item() });
  });

  it("stays due after the date has passed — the generator applies the catch-up window", () => {
    expect(classifyDeal(deal("2026-10-01", [item()]), "2026-10-20")).toMatchObject({ kind: "cycle", due: true, periodStart: "2026-10-01" });
  });

  it("is not due before the date, and says when the quote will go", () => {
    const result = classifyDeal(deal("2026-10-01", [item()]), "2026-09-22");
    expect(result).toMatchObject({ kind: "cycle", months: 1, due: false, periodStart: "2026-10-01", reason: expect.stringMatching(/2026-10-01/) });
  });

  it("a quarterly client is due on their Next Renewal Date at what they paid last time", () => {
    const result = classifyDeal(deal("2026-10-09", [quarterly()]), "2026-10-09");
    expect(result).toEqual({ kind: "cycle", months: 3, due: true, periodStart: "2026-10-09", amount: 39000, latest: quarterly() });
  });

  it("a monthly-term item with quantity 3 is a 3-month cycle at price × quantity", () => {
    const threeMonths = item({ id: "li-3", billingPeriodTerm: "P1M", quantity: 3, price: 10000 });
    expect(classifyDeal(deal("2026-10-01", [threeMonths]), "2026-10-01")).toEqual({
      kind: "cycle",
      months: 3,
      due: true,
      periodStart: "2026-10-01",
      amount: 30000,
      latest: threeMonths,
    });
  });

  it("a quantity of 12 or more months is left to the due-date flow like a yearly term", () => {
    expect(classifyDeal(deal("2026-10-01", [item({ quantity: 12 })]), "2026-10-01")).toMatchObject({
      kind: "none",
      reason: expect.stringContaining("year or longer"),
    });
  });

  it("is not billed when the quantity is not a whole number of months", () => {
    expect(classifyDeal(deal("2026-10-01", [item({ quantity: 1.5 })]), "2026-10-01")).toMatchObject({
      kind: "none",
      reason: expect.stringContaining("whole number"),
    });
  });

  it("uses price × quantity as the amount for a term (the live monthly/P6M rows)", () => {
    const sixMonths = item({ id: "li-6", billingPeriodTerm: "P6M", quantity: 6, price: 3500 });
    expect(classifyDeal(deal("2026-10-01", [sixMonths]), "2026-10-01")).toMatchObject({ kind: "cycle", months: 6, amount: 21000 });
  });

  it("ignores the line item's own start and end dates entirely", () => {
    // Line item says paid through November, but the deal says the next renewal is 1 October: due.
    expect(classifyDeal(deal("2026-10-01", [item({ billingTermEndDate: "2026-11-01" })]), "2026-10-01")).toMatchObject({ due: true });
    // Line item ended in August, but the deal says 1 November: not due yet.
    expect(classifyDeal(deal("2026-11-01", [item({ billingTermEndDate: "2026-08-01" })]), "2026-10-01")).toMatchObject({ due: false });
  });

  it("is never due without a real Next Renewal Date (blank, or HubSpot's 1970-01-01 placeholder)", () => {
    for (const value of [null, "1970-01-01"]) {
      const result = classifyDeal(deal(value, [item()]), "2026-10-01");
      expect(result).toMatchObject({ kind: "cycle", months: 1, due: false, periodStart: null, reason: expect.stringMatching(/Next Renewal Date/) });
    }
  });

  it("takes the term and price from the latest line item by end date, ignoring undated ones", () => {
    const old = quarterly({ id: "old", billingTermEndDate: "2026-07-01" });
    const bare = item({ id: "bare", billingPeriodTerm: null, billingTermEndDate: null });
    const result = classifyDeal(deal("2026-10-01", [old, bare, item()]), "2026-10-01");
    expect(result).toMatchObject({ kind: "cycle", months: 1, latest: { id: "li-1" } });
  });
});

describe("classifyDeal — not billed by cycles", () => {
  it("leaves yearly terms (P1Y / P12M) to the legacy due-date flow", () => {
    for (const term of ["P1Y", "P12M"]) {
      expect(classifyDeal(deal("2026-10-01", [item({ billingPeriodTerm: term })]), "2026-10-01")).toMatchObject({
        kind: "none",
        reason: expect.stringMatching(/year or longer/i),
      });
    }
  });

  it("bills any number of months under a year as a cycle (the live P7M client: 3986 × 7)", () => {
    const seven = item({ id: "li-7", billingPeriodTerm: "P7M", quantity: 7, price: 3986 });
    expect(classifyDeal(deal("2026-10-01", [seven]), "2026-10-01")).toEqual({
      kind: "cycle",
      months: 7,
      due: true,
      periodStart: "2026-10-01",
      amount: 27902,
      latest: seven,
    });
    expect(classifyDeal(deal("2026-10-01", [item({ billingPeriodTerm: "P11M" })]), "2026-10-01")).toMatchObject({ kind: "cycle", months: 11 });
  });

  it("leaves anything of a year or longer (P12M, P1Y, P18M) to the legacy due-date flow", () => {
    expect(classifyDeal(deal("2026-10-01", [item({ billingPeriodTerm: "P18M" })]), "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/year/i) });
  });

  it("is not billed when the latest item has no usable term", () => {
    expect(classifyDeal(deal("2026-10-01", [item({ billingPeriodTerm: null })]), "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/term/i) });
    expect(classifyDeal(deal("2026-10-01", [item({ billingPeriodTerm: "P1W" })]), "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/P1W/) });
  });

  it("is not billed when no line item carries a billing end date", () => {
    expect(classifyDeal(deal("2026-10-01", [item({ billingTermEndDate: null })]), "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/no line item/i) });
  });

  it("fails closed when two latest items tie with different terms", () => {
    const a = item({ id: "a" });
    const b = quarterly({ id: "b", billingTermEndDate: "2026-10-01" });
    expect(classifyDeal(deal("2026-10-01", [a, b]), "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/disagree/) });
  });

  it("fails closed when the line items could not be read", () => {
    expect(classifyDeal({ ...deal("2026-10-01", []), lineItemsError: "HubSpot API error 500" }, "2026-10-01")).toMatchObject({ kind: "none", reason: expect.stringMatching(/500/) });
  });
});
