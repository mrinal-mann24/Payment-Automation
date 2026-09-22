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

const deal = (dealId: string, nextRenewalDate: string | null, lineItems: HubspotLineItem[]): VaDealWithLineItems => ({
  dealId,
  dealName: `${dealId} <> VA`,
  dealStage: "3102360263",
  billingCycle: "Monthly",
  nextRenewalDate,
  lineItems,
});

// 11:00 IST on 1 October 2026.
const oct1 = new Date("2026-10-01T05:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchVaDealsWithLineItems).mockResolvedValue([
    deal("monthly-due", "2026-10-01", [item()]),
    deal("future", "2026-10-09", [item()]),
    deal("quarterly-stale", "2026-08-10", [item({ billingPeriodTerm: "P3M", price: 21000 })]),
    deal("no-date", null, [item()]),
    deal("yearly", "2026-10-01", [item({ billingPeriodTerm: "P1Y" })]),
    deal("seven-month", "2026-10-01", [item({ billingPeriodTerm: "P7M", quantity: 7, price: 3986 })]),
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

describe("generateRenewalQuote (POST /webhooks/renewal)", () => {
  it("quotes a client whose Next Renewal Date has arrived, from that date", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "monthly-due", oct1);

    expect(outcome.kind).toBe("cycle");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toMatchObject({ key: "2026-10-01", months: 1, amount: null });
  });

  it("quotes a client whose date passed weeks ago — the manual route ignores the catch-up window", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "quarterly-stale", oct1);

    expect(outcome.kind).toBe("cycle");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toMatchObject({ key: "2026-08-10", months: 3, amount: 21000 });
  });

  it("refuses a client whose date is still ahead, or who has no date", async () => {
    await expect(generateRenewalQuote(fakeSupabase, "future", oct1)).rejects.toThrow(/2026-10-09/);
    await expect(generateRenewalQuote(fakeSupabase, "no-date", oct1)).rejects.toThrow(QuoteNotDueError);
    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });

  it("quotes a seven-month client for seven months at what they paid last time", async () => {
    const outcome = await generateRenewalQuote(fakeSupabase, "seven-month", oct1);

    expect(outcome.kind).toBe("cycle");
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toMatchObject({ key: "2026-10-01", months: 7, amount: 27902 });
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
