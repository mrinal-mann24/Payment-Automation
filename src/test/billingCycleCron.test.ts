import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../clients/hubspot.js", () => ({ fetchVaDealsWithLineItems: vi.fn() }));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));
vi.mock("../repositories/renewalJobs.js", () => ({ findOpenLegacyJob: vi.fn() }));

import { fetchVaDealsWithLineItems, type HubspotLineItem, type VaDealWithLineItems } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { classifyVaDeals, isBilledByCycles, runBillingCycleCheck } from "../jobs/billingCycleCron.js";

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

const quarterlyEnding = (end: string): HubspotLineItem =>
  item({ id: "li-q", recurringBillingFrequency: "quarterly", billingPeriodTerm: "P3M", billingTermEndDate: end, price: 39000 });

const deal = (dealId: string, lineItems: HubspotLineItem[], billingCycle = "Monthly"): VaDealWithLineItems => ({
  dealId,
  dealName: `${dealId} <> VA`,
  dealStage: "3102360263",
  billingCycle,
  lineItems,
});

const deals: VaDealWithLineItems[] = [
  deal("due-1", [item()]),
  deal("due-2", [item()]),
  deal("annual", [item({ recurringBillingFrequency: "annually", billingPeriodTerm: "P1Y" })], "Annual"),
  deal("prepaid", [item({ billingTermEndDate: "2026-11-01" })]),
  deal("quarterly-today", [quarterlyEnding("2026-10-01")], "Quarterly"),
  deal("quarterly-stale", [quarterlyEnding("2026-08-10")]),
  deal("quarterly-future", [quarterlyEnding("2026-10-09")], "Quarterly"),
  deal("seven-month", [item({ billingPeriodTerm: "P7M", quantity: 7, billingTermEndDate: "2026-09-30" })]),
];

// 11:00 IST on the given October 2026 day.
const istTick = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T05:30:00Z`);

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

const generated = () => vi.mocked(runRenewalPipeline).mock.calls.map((c) => [c[1], c[2]?.key ?? null, c[2]?.amount ?? null]);

describe("classifyVaDeals", () => {
  it("classifies every active deal against the IST date of the tick", async () => {
    const classified = await classifyVaDeals(istTick(1));

    expect(classified.cycle.key).toBe("2026-10");
    expect(classified.today).toBe("2026-10-01");
    expect(classified.day).toBe(1);
    expect(classified.deals.map((d) => [d.dealId, d.classification.kind, "due" in d.classification ? d.classification.due : null])).toEqual([
      ["due-1", "monthly", true],
      ["due-2", "monthly", true],
      ["annual", "none", null],
      ["prepaid", "monthly", false],
      ["quarterly-today", "term", true],
      ["quarterly-stale", "term", true],
      ["quarterly-future", "term", false],
      ["seven-month", "unsupported", null],
    ]);
  });

  it("isBilledByCycles keeps monthly, term and unsupported deals away from the legacy due-date cron", async () => {
    const classified = await classifyVaDeals(istTick(1));

    expect(classified.deals.filter((d) => isBilledByCycles(d.classification)).map((d) => d.dealId)).toEqual([
      "due-1",
      "due-2",
      "prepaid",
      "quarterly-today",
      "quarterly-stale",
      "quarterly-future",
      "seven-month",
    ]);
  });
});

describe("runBillingCycleCheck", () => {
  it("on the 1st generates every due monthly cycle and the quarterly term ending today, nothing else (TEST 7, TEST 8)", async () => {
    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated()).toEqual([
      ["due-1", "2026-10", null],
      ["due-2", "2026-10", null],
      ["quarterly-today", "2026-10-01", 39000],
    ]);
  });

  it("monthly cycles stop after the 4th, but a term ending on the 9th is quoted on the 9th", async () => {
    await runBillingCycleCheck(await classifyVaDeals(istTick(9)), { pauseMs: 0 });

    expect(generated()).toEqual([["quarterly-future", "2026-10-09", 39000]]);
  });

  it("retries a term through the three days after it ends and then leaves it to Quote now", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([
      deal("three-days", [quarterlyEnding("2026-09-28")]),
      deal("four-days", [quarterlyEnding("2026-09-27")]),
    ]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated()).toEqual([["three-days", "2026-09-28", 39000]]);
  });

  it("skips a deal that still has an unpaid legacy quote so it is never billed twice", async () => {
    vi.mocked(findOpenLegacyJob).mockImplementation(async (_supabase, dealId) =>
      dealId === "due-1" ? ({ zoho_estimate_number: "QT-9" } as never) : null,
    );

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated().map((g) => g[0])).toEqual(["due-2", "quarterly-today"]);
  });

  it("keeps going when one deal fails", async () => {
    vi.mocked(runRenewalPipeline).mockRejectedValueOnce(new Error("Zoho Books API error 500"));

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated().map((g) => g[0])).toEqual(["due-1", "due-2", "quarterly-today"]);
  });
});
