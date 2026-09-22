import { describe, expect, it } from "vitest";
import { classifyDeal } from "../utils/monthlyEligibility.js";
import type { HubspotLineItem } from "../clients/hubspot.js";

const monthlyItem = (overrides: Partial<HubspotLineItem> = {}): HubspotLineItem => ({
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

const deal = (billingCycle: string | null, lineItems: HubspotLineItem[]) => ({
  dealId: "deal-1",
  dealName: "Acme <> VA",
  dealStage: "3102360263",
  billingCycle,
  lineItems,
});

describe("classifyDeal", () => {
  it("is monthly and due when the deal says Monthly and the latest item is monthly/P1M ending at month start", () => {
    const result = classifyDeal(deal("Monthly", [monthlyItem()]), "2026-10-01");
    expect(result).toMatchObject({ monthly: true, due: true, latest: { id: "li-1" } });
  });

  it("picks the latest line item by billing end date, ignoring undated ones", () => {
    const old = monthlyItem({
      id: "old",
      recurringBillingFrequency: "quarterly",
      billingPeriodTerm: "P3M",
      billingTermEndDate: "2026-07-01",
    });
    const bare = monthlyItem({
      id: "bare",
      recurringBillingFrequency: null,
      billingPeriodTerm: null,
      billingTermEndDate: null,
    });
    const result = classifyDeal(deal("Monthly", [old, bare, monthlyItem()]), "2026-10-01");
    expect(result).toMatchObject({ monthly: true, due: true, latest: { id: "li-1" } });
  });

  it("is monthly but not due when the latest item already covers past the month start", () => {
    const result = classifyDeal(deal("Monthly", [monthlyItem({ billingTermEndDate: "2026-11-01" })]), "2026-10-01");
    expect(result).toMatchObject({ monthly: true, due: false });
    expect((result as { reason: string }).reason).toMatch(/2026-11-01/);
  });

  it("is not monthly when the deal billing_cycle is Annual, Quarterly or unset (TEST 8)", () => {
    expect(
      classifyDeal(
        deal("Annual", [monthlyItem({ recurringBillingFrequency: "annually", billingPeriodTerm: "P1Y" })]),
        "2026-10-01",
      ),
    ).toMatchObject({ monthly: false, reason: expect.stringMatching(/Annual/) });
    expect(classifyDeal(deal("Quarterly", [monthlyItem()]), "2026-10-01")).toMatchObject({
      monthly: false,
      reason: expect.stringMatching(/Quarterly/),
    });
    expect(classifyDeal(deal(null, [monthlyItem()]), "2026-10-01")).toMatchObject({
      monthly: false,
      reason: expect.stringMatching(/not set/),
    });
  });

  it("is not monthly when the deal says Monthly but the latest item is not monthly/P1M (the live mismatches)", () => {
    const mismatches: Array<[string, string]> = [
      ["quarterly", "P3M"],
      ["per_six_months", "P6M"],
      ["monthly", "P6M"],
      ["monthly", "P7M"],
      ["annually", "P12M"],
    ];
    for (const [freq, term] of mismatches) {
      const result = classifyDeal(
        deal("Monthly", [monthlyItem({ recurringBillingFrequency: freq, billingPeriodTerm: term })]),
        "2026-10-01",
      );
      expect(result).toMatchObject({ monthly: false, reason: expect.stringContaining(`${freq}/${term}`) });
    }
  });

  it("is not monthly when no line item carries a billing end date", () => {
    const result = classifyDeal(deal("Monthly", [monthlyItem({ billingTermEndDate: null })]), "2026-10-01");
    expect(result).toMatchObject({ monthly: false, reason: expect.stringMatching(/no line item/i) });
  });

  it("fails closed when two latest items tie with different frequencies", () => {
    const a = monthlyItem({ id: "a" });
    const b = monthlyItem({ id: "b", recurringBillingFrequency: "quarterly", billingPeriodTerm: "P3M" });
    const result = classifyDeal(deal("Monthly", [a, b]), "2026-10-01");
    expect(result).toMatchObject({ monthly: false, reason: expect.stringMatching(/disagree/) });
  });

  it("fails closed when the line items could not be read", () => {
    const result = classifyDeal({ ...deal("Monthly", []), lineItemsError: "HubSpot API error 500" }, "2026-10-01");
    expect(result).toMatchObject({ monthly: false, reason: expect.stringMatching(/500/) });
  });
});
