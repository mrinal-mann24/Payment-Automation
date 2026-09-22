import { describe, expect, it } from "vitest";
import { classifyDeal, termMonths } from "../utils/monthlyEligibility.js";
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

// The deal-level Billing Cycle field is deliberately NOT part of the rule;
// it is wrong on five live deals. Only the latest line item's Term counts.
const deal = (billingCycle: string | null, lineItems: HubspotLineItem[]) => ({
  dealId: "deal-1",
  dealName: "Acme <> VA",
  dealStage: "3102360263",
  billingCycle,
  lineItems,
});

describe("termMonths", () => {
  it("reads HubSpot's ISO-8601 term as a number of months", () => {
    expect(["P1M", "P3M", "P6M", "P7M", "P12M", "P1Y"].map(termMonths)).toEqual([1, 3, 6, 7, 12, 12]);
    expect([null, undefined, "", "P1W", "monthly"].map(termMonths)).toEqual([null, null, null, null, null]);
  });
});

describe("classifyDeal — monthly (latest term P1M)", () => {
  it("is monthly and due when the latest item ends on or before the 1st of this month", () => {
    const result = classifyDeal(deal("Monthly", [item()]), "2026-10-01");
    expect(result).toMatchObject({ kind: "monthly", due: true, latest: { id: "li-1" } });
  });

  it("picks the latest line item by billing end date, ignoring undated ones", () => {
    const old = quarterly({ id: "old", billingTermEndDate: "2026-07-01" });
    const bare = item({ id: "bare", recurringBillingFrequency: null, billingPeriodTerm: null, billingTermEndDate: null });
    const result = classifyDeal(deal("Monthly", [old, bare, item()]), "2026-10-01");
    expect(result).toMatchObject({ kind: "monthly", due: true, latest: { id: "li-1" } });
  });

  it("is monthly but not due when the latest item already covers past the month start", () => {
    const result = classifyDeal(deal("Monthly", [item({ billingTermEndDate: "2026-11-01" })]), "2026-10-15");
    expect(result).toMatchObject({ kind: "monthly", due: false, reason: expect.stringMatching(/2026-11-01/) });
  });

  it("decides from the line item term alone, whatever the deal's Billing Cycle field or frequency label says", () => {
    expect(classifyDeal(deal("Quarterly", [item()]), "2026-10-01")).toMatchObject({ kind: "monthly", due: true });
    expect(classifyDeal(deal(null, [item()]), "2026-10-01")).toMatchObject({ kind: "monthly", due: true });
    expect(classifyDeal(deal("Monthly", [item({ recurringBillingFrequency: null })]), "2026-10-01")).toMatchObject({
      kind: "monthly",
      due: true,
    });
  });
});

describe("classifyDeal — term cycles (latest term P3M or P6M)", () => {
  it("is a quarterly term, due from the day the last term ended, billed at the last-paid amount", () => {
    const result = classifyDeal(deal("Quarterly", [quarterly()]), "2026-10-09");
    expect(result).toEqual({
      kind: "term",
      months: 3,
      due: true,
      periodStart: "2026-10-09",
      lastPaid: 39000,
      latest: quarterly(),
    });
  });

  it("stays due after the end date — the generator, not the classifier, applies the catch-up window", () => {
    expect(classifyDeal(deal("Quarterly", [quarterly()]), "2026-11-20")).toMatchObject({ kind: "term", due: true });
  });

  it("is not due before the term ends", () => {
    const result = classifyDeal(deal("Quarterly", [quarterly()]), "2026-10-01");
    expect(result).toMatchObject({ kind: "term", months: 3, due: false, reason: expect.stringMatching(/2026-10-09/) });
  });

  it("uses price × quantity as the last-paid amount and ignores the frequency label (the live monthly/P6M rows)", () => {
    const sixMonths = item({
      id: "li-6",
      recurringBillingFrequency: "monthly",
      billingPeriodTerm: "P6M",
      quantity: 6,
      price: 3500,
      billingTermEndDate: "2027-01-31",
    });
    const result = classifyDeal(deal("Monthly", [sixMonths]), "2027-01-31");
    expect(result).toMatchObject({ kind: "term", months: 6, due: true, periodStart: "2027-01-31", lastPaid: 21000 });
  });
});

describe("classifyDeal — not billed by cycles", () => {
  it("leaves yearly terms (P1Y / P12M) to the legacy due-date flow", () => {
    for (const term of ["P1Y", "P12M"]) {
      const result = classifyDeal(deal("Annual", [item({ billingPeriodTerm: term, billingTermEndDate: "2027-04-29" })]), "2026-10-01");
      expect(result).toMatchObject({ kind: "none", reason: expect.stringMatching(/yearly/i) });
    }
  });

  it("flags an odd term such as P7M as unsupported so nothing bills it automatically", () => {
    const result = classifyDeal(deal("Monthly", [item({ billingPeriodTerm: "P7M", quantity: 7 })]), "2026-10-01");
    expect(result).toMatchObject({ kind: "unsupported", reason: expect.stringMatching(/P7M/) });
  });

  it("is not billed when the latest item has no usable term", () => {
    expect(classifyDeal(deal("Monthly", [item({ billingPeriodTerm: null })]), "2026-10-01")).toMatchObject({
      kind: "none",
      reason: expect.stringMatching(/term/i),
    });
    expect(classifyDeal(deal("Monthly", [item({ billingPeriodTerm: "P1W" })]), "2026-10-01")).toMatchObject({
      kind: "none",
      reason: expect.stringMatching(/P1W/),
    });
  });

  it("is not billed when no line item carries a billing end date", () => {
    const result = classifyDeal(deal("Monthly", [item({ billingTermEndDate: null })]), "2026-10-01");
    expect(result).toMatchObject({ kind: "none", reason: expect.stringMatching(/no line item/i) });
  });

  it("fails closed when two latest items tie with different terms", () => {
    const a = item({ id: "a" });
    const b = quarterly({ id: "b", billingTermEndDate: "2026-10-01" });
    const result = classifyDeal(deal("Monthly", [a, b]), "2026-10-01");
    expect(result).toMatchObject({ kind: "none", reason: expect.stringMatching(/disagree/) });
  });

  it("fails closed when the line items could not be read", () => {
    const result = classifyDeal({ ...deal("Monthly", []), lineItemsError: "HubSpot API error 500" }, "2026-10-01");
    expect(result).toMatchObject({ kind: "none", reason: expect.stringMatching(/500/) });
  });
});
