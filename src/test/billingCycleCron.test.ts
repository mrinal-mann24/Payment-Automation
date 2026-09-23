import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../clients/hubspot.js", () => ({ fetchVaDealsWithLineItems: vi.fn() }));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));
vi.mock("../repositories/renewalJobs.js", () => ({ findOpenLegacyJob: vi.fn() }));
vi.mock("../repositories/clientPricing.js", () => ({ findPausedDealIds: vi.fn() }));

import { fetchVaDealsWithLineItems, type HubspotLineItem, type VaDealWithLineItems } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { findPausedDealIds } from "../repositories/clientPricing.js";
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

const quarterlyItem = item({ id: "li-q", recurringBillingFrequency: "quarterly", billingPeriodTerm: "P3M", price: 39000 });

const deal = (dealId: string, nextRenewalDate: string | null, lineItems: HubspotLineItem[]): VaDealWithLineItems => ({
  dealId,
  dealName: `${dealId} <> VA`,
  dealStage: "3102360263",
  billingCycle: "Monthly",
  nextRenewalDate,
  lineItems,
});

const deals: VaDealWithLineItems[] = [
  deal("due-1", "2026-10-01", [item()]),
  deal("due-2", "2026-10-01", [item()]),
  deal("quarterly-today", "2026-10-01", [quarterlyItem]),
  deal("future", "2026-10-09", [quarterlyItem]),
  deal("stale", "2026-08-10", [item()]),
  deal("no-date", null, [item()]),
  deal("annual", "2026-10-01", [item({ billingPeriodTerm: "P1Y" })]),
  deal("seven-month", "2026-10-01", [item({ billingPeriodTerm: "P7M", quantity: 7, price: 3986 })]),
];

// 11:00 IST on the given October 2026 day.
const istTick = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T05:30:00Z`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue(deals);
  vi.mocked(findOpenLegacyJob).mockResolvedValue(null);
  vi.mocked(findPausedDealIds).mockResolvedValue(new Set());
  vi.mocked(runRenewalPipeline).mockResolvedValue({
    billingPeriod: "2026-10-01",
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

const generated = () => vi.mocked(runRenewalPipeline).mock.calls.map((c) => [c[1], c[2]?.key ?? null, c[2]?.months ?? null, c[2]?.amount ?? null]);

describe("classifyVaDeals", () => {
  it("classifies every active deal against the IST date of the tick", async () => {
    const classified = await classifyVaDeals(istTick(1));

    expect(classified.today).toBe("2026-10-01");
    expect(classified.deals.map((d) => [d.dealId, d.classification.kind, "due" in d.classification ? d.classification.due : null])).toEqual([
      ["due-1", "cycle", true],
      ["due-2", "cycle", true],
      ["quarterly-today", "cycle", true],
      ["future", "cycle", false],
      ["stale", "cycle", true],
      ["no-date", "cycle", false],
      ["annual", "none", null],
      ["seven-month", "cycle", true],
    ]);
  });

  it("isBilledByCycles keeps every cycle deal away from the legacy due-date cron", async () => {
    const classified = await classifyVaDeals(istTick(1));

    expect(classified.deals.filter((d) => !isBilledByCycles(d.classification)).map((d) => d.dealId)).toEqual(["annual"]);
  });
});

describe("runBillingCycleCheck", () => {
  it("quotes every client whose Next Renewal Date is today, monthly at the base price and quarterly at the last-paid amount", async () => {
    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated()).toEqual([
      ["due-1", "2026-10-01", 1, null],
      ["due-2", "2026-10-01", 1, null],
      ["quarterly-today", "2026-10-01", 3, 39000],
      ["seven-month", "2026-10-01", 7, 27902],
    ]);
  });

  it("never quotes a client whose auto quote is switched off on the admin page", async () => {
    vi.mocked(findPausedDealIds).mockResolvedValue(new Set(["due-2", "quarterly-today"]));

    const classified = await classifyVaDeals(istTick(1));
    await runBillingCycleCheck(classified, { pauseMs: 0 });

    expect(classified.paused).toEqual(new Set(["due-2", "quarterly-today"]));
    expect(generated().map((g) => g[0])).toEqual(["due-1", "seven-month"]);
  });

  it("quotes a client on their own date, whatever day of the month it is", async () => {
    await runBillingCycleCheck(await classifyVaDeals(istTick(9)), { pauseMs: 0 });

    expect(generated()).toEqual([["future", "2026-10-09", 3, 39000]]);
  });

  it("retries for three days after the date and then leaves it to the team to fix in HubSpot", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([
      deal("three-days", "2026-09-28", [item()]),
      deal("four-days", "2026-09-27", [item()]),
    ]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated().map((g) => g[0])).toEqual(["three-days"]);
  });

  it("skips a deal that still has an unpaid legacy quote so it is never billed twice", async () => {
    vi.mocked(findOpenLegacyJob).mockImplementation(async (_supabase, dealId) =>
      dealId === "due-1" ? ({ zoho_estimate_number: "QT-9" } as never) : null,
    );

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated().map((g) => g[0])).toEqual(["due-2", "quarterly-today", "seven-month"]);
  });

  it("keeps going when one deal fails", async () => {
    vi.mocked(runRenewalPipeline).mockRejectedValueOnce(new Error("Zoho Books API error 500"));

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseMs: 0 });

    expect(generated().map((g) => g[0])).toEqual(["due-1", "due-2", "quarterly-today", "seven-month"]);
  });
});
