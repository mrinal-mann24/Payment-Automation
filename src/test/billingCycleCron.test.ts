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
import {
  DEFAULT_PAUSE_RANGE_MS,
  classifyVaDeals,
  isBilledByCycles,
  randomPauseMs,
  runBillingCycleCheck,
} from "../jobs/billingCycleCron.js";

describe("randomPauseMs", () => {
  it("draws a gap anywhere between min and max, so quotes never leave on a fixed beat", () => {
    const range = { min: 60_000, max: 180_000 };
    expect(randomPauseMs(range, () => 0)).toBe(60_000);
    expect(randomPauseMs(range, () => 1)).toBe(180_000);
    expect(randomPauseMs(range, () => 0.5)).toBe(120_000);
    expect(randomPauseMs({ min: 0, max: 0 }, Math.random)).toBe(0);
  });

  it("defaults to 1–3 minutes between quotes", () => {
    expect(DEFAULT_PAUSE_RANGE_MS).toEqual({ min: 60_000, max: 180_000 });
  });
});

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
    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated()).toEqual([
      ["due-1", "2026-10-01", 1, 5000],
      ["due-2", "2026-10-01", 1, 5000],
      ["quarterly-today", "2026-10-01", 3, 39000],
      // Monthly clients are quoted every month whatever HubSpot's date says
      // (decision 2026-10-07): a stale date and a missing date included.
      ["stale", "2026-10-01", 1, 5000],
      ["no-date", "2026-10-01", 1, 5000],
      ["seven-month", "2026-10-01", 7, 27902],
    ]);
  });

  it("quotes a monthly client on the 1st–4th of the month even when its HubSpot date is old, but not on the 5th", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([deal("stale-monthly", "2026-07-01", [item()])]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(4)), { pauseRangeMs: { min: 0, max: 0 } });
    expect(generated()).toEqual([["stale-monthly", "2026-10-01", 1, 5000]]);

    vi.mocked(runRenewalPipeline).mockClear();
    await runBillingCycleCheck(await classifyVaDeals(istTick(5)), { pauseRangeMs: { min: 0, max: 0 } });
    expect(generated()).toEqual([]);
  });

  it("does not make a multi-month client monthly: a stale quarterly date is still left for the team to fix", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([deal("stale-quarterly", "2026-07-01", [quarterlyItem])]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated()).toEqual([]);
  });

  it("never quotes a client whose auto quote is switched off on the admin page", async () => {
    vi.mocked(findPausedDealIds).mockResolvedValue(new Set(["due-2", "quarterly-today", "stale"]));

    const classified = await classifyVaDeals(istTick(1));
    await runBillingCycleCheck(classified, { pauseRangeMs: { min: 0, max: 0 } });

    expect(classified.paused).toEqual(new Set(["due-2", "quarterly-today", "stale"]));
    expect(generated().map((g) => g[0])).toEqual(["due-1", "no-date", "seven-month"]);
  });

  it("quotes a client on their own date, for the month the quote is issued in (decision 2026-10-07)", async () => {
    await runBillingCycleCheck(await classifyVaDeals(istTick(9)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated()).toEqual([["future", "2026-10-01", 3, 39000]]);
  });

  it("a catch-up quote a few days after the date is still for the month it is issued in", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([deal("three-days", "2026-09-28", [item()])]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated()).toEqual([["three-days", "2026-10-01", 1, 5000]]);
  });

  it("retries a multi-month client for three days after its date and then leaves it to the team to fix in HubSpot", async () => {
    vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([
      deal("three-days", "2026-09-28", [quarterlyItem]),
      deal("four-days", "2026-09-27", [quarterlyItem]),
    ]);

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated().map((g) => g[0])).toEqual(["three-days"]);
  });

  it("skips a deal that still has an unpaid legacy quote so it is never billed twice", async () => {
    vi.mocked(findOpenLegacyJob).mockImplementation(async (_supabase, dealId) =>
      dealId === "due-1" ? ({ zoho_estimate_number: "QT-9" } as never) : null,
    );

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated().map((g) => g[0])).toEqual(["due-2", "quarterly-today", "stale", "no-date", "seven-month"]);
  });

  it("keeps going when one deal fails", async () => {
    vi.mocked(runRenewalPipeline).mockRejectedValueOnce(new Error("Zoho Books API error 500"));

    await runBillingCycleCheck(await classifyVaDeals(istTick(1)), { pauseRangeMs: { min: 0, max: 0 } });

    expect(generated().map((g) => g[0])).toEqual(["due-1", "due-2", "quarterly-today", "stale", "no-date", "seven-month"]);
  });
});
