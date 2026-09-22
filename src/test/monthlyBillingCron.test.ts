import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../clients/hubspot.js", () => ({ fetchVaDealsWithLineItems: vi.fn() }));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));
vi.mock("../repositories/renewalJobs.js", () => ({ findOpenLegacyJob: vi.fn() }));

import { fetchVaDealsWithLineItems, type HubspotLineItem } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { classifyVaDeals, runMonthlyBillingCheck } from "../jobs/monthlyBillingCron.js";

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

const deals = [
  { dealId: "due-1", dealName: "One <> VA", dealStage: "3102360263", billingCycle: "Monthly", lineItems: [item()] },
  { dealId: "due-2", dealName: "Two <> VA", dealStage: "2462646003", billingCycle: "Monthly", lineItems: [item()] },
  {
    dealId: "annual",
    dealName: "Three <> VA",
    dealStage: "3668025064",
    billingCycle: "Annual",
    lineItems: [item({ recurringBillingFrequency: "annually", billingPeriodTerm: "P1Y" })],
  },
  {
    dealId: "prepaid",
    dealName: "Four <> VA",
    dealStage: "3102360263",
    billingCycle: "Monthly",
    lineItems: [item({ billingTermEndDate: "2026-11-01" })],
  },
];

// 11:00 IST on 1 October 2026 — the normal cron tick.
const oct1 = new Date("2026-10-01T05:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue(deals);
  vi.mocked(findOpenLegacyJob).mockResolvedValue(null);
  vi.mocked(runRenewalPipeline).mockResolvedValue({
    billingPeriod: "2026-10",
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

describe("classifyVaDeals", () => {
  it("classifies every active deal against the current IST month", async () => {
    const classified = await classifyVaDeals(oct1);

    expect(classified.cycle.key).toBe("2026-10");
    expect(classified.day).toBe(1);
    expect(
      classified.deals.map((d) => [d.dealId, d.classification.monthly, "due" in d.classification ? d.classification.due : null]),
    ).toEqual([
      ["due-1", true, true],
      ["due-2", true, true],
      ["annual", false, null],
      ["prepaid", true, false],
    ]);
  });
});

describe("runMonthlyBillingCheck", () => {
  it("on the 1st generates the cycle for every monthly-and-due deal and nothing else (TEST 7, TEST 8)", async () => {
    const classified = await classifyVaDeals(oct1);

    await runMonthlyBillingCheck(classified, { pauseMs: 0 });

    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => [c[1], c[2]?.key])).toEqual([
      ["due-1", "2026-10"],
      ["due-2", "2026-10"],
    ]);
  });

  it("does nothing after the 4th of the month", async () => {
    const classified = await classifyVaDeals(new Date("2026-10-05T05:30:00Z"));

    await runMonthlyBillingCheck(classified, { pauseMs: 0 });

    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });

  it("skips a deal that still has an unpaid legacy quote so it is never billed twice", async () => {
    vi.mocked(findOpenLegacyJob).mockImplementation(async (_supabase, dealId) =>
      dealId === "due-1" ? ({ zoho_estimate_number: "QT-9" } as never) : null,
    );
    const classified = await classifyVaDeals(oct1);

    await runMonthlyBillingCheck(classified, { pauseMs: 0 });

    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => c[1])).toEqual(["due-2"]);
  });

  it("keeps going when one deal fails", async () => {
    vi.mocked(runRenewalPipeline).mockRejectedValueOnce(new Error("Zoho Books API error 500"));
    const classified = await classifyVaDeals(oct1);

    await runMonthlyBillingCheck(classified, { pauseMs: 0 });

    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => c[1])).toEqual(["due-1", "due-2"]);
  });
});
