import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({ fetchVaDealsWithLineItems: vi.fn() }));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));

import { fetchVaDealsWithLineItems, type HubspotLineItem, type VaDealWithLineItems } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { generateRenewalQuote, QuoteNotDueError } from "../jobs/generateRenewalQuote.js";

const fakeSupabase = {} as SupabaseClient;

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
  productId: null,
  ...overrides,
});

const deal = (dealId: string, lineItems: HubspotLineItem[]): VaDealWithLineItems => ({
  dealId,
  dealName: `${dealId} <> VA`,
  dealStage: "3102360263",
  billingCycle: "Monthly",
  lineItems,
});

// 11:00 IST on 1 October 2026.
const oct1 = new Date("2026-10-01T05:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([
    deal("monthly-due", [item()]),
    deal("monthly-prepaid", [item({ billingTermEndDate: "2026-11-01" })]),
    deal("quarterly-stale", [item({ billingPeriodTerm: "P3M", billingTermEndDate: "2026-08-10", price: 21000 })]),
    deal("quarterly-future", [item({ billingPeriodTerm: "P3M", billingTermEndDate: "2026-10-09", price: 39000 })]),
    deal("yearly", [item({ billingPeriodTerm: "P1Y", billingTermEndDate: "2027-04-29" })]),
    deal("seven-month", [item({ billingPeriodTerm: "P7M", billingTermEndDate: "2026-09-30" })]),
  ]);
  vi.mocked(runRenewalPipeline).mockResolvedValue({
    billingPeriod: "x",
    zohoEstimateId: "zest-1",
    zohoEstimateNumber: "QT-1",
    paymentLinkId: "plink-1",
    shortUrl: "https://rzp.io/i/1",
    periskopeSent: true,
    periskopeSkipReason: null,
    emailSent: true,
    emailError: null,
  });
});

describe("generateRenewalQuote (manual 'Quote now' / renewal webhook)", () => {
  it("quotes a due monthly deal for the current IST month", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "monthly-due", oct1);

    expect(outcome.kind).toBe("monthly");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toMatchObject({ key: "2026-10", months: 1, amount: null });
  });

  it("quotes a term deal whose term has ended, however long ago — the manual route ignores the catch-up window", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "quarterly-stale", oct1);

    expect(outcome.kind).toBe("term");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toMatchObject({ key: "2026-08-10", months: 3, amount: 21000 });
  });

  it("refuses a monthly deal already billed for the month and a term that has not ended yet", async () => {
    await expect(generateRenewalQuote(fakeSupabase, "monthly-prepaid", oct1)).rejects.toThrow(QuoteNotDueError);
    await expect(generateRenewalQuote(fakeSupabase, "quarterly-future", oct1)).rejects.toThrow(/2026-10-09/);
    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });

  it("refuses an unsupported term rather than guessing", async () => {
    await expect(generateRenewalQuote(fakeSupabase, "seven-month", oct1)).rejects.toThrow(/P7M/);
    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });

  it("runs the legacy due-date pipeline for a deal no cycle owns (yearly)", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "yearly", oct1);

    expect(outcome.kind).toBe("none");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]!.slice(0, 2)).toEqual([fakeSupabase, "yearly"]);
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toBeUndefined();
  });

  it("refuses a deal that is not in the active VA deal list", async () => {
    await expect(generateRenewalQuote(fakeSupabase, "unknown", oct1)).rejects.toThrow(/active VA deal list/);
    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });
});
