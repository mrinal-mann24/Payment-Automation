import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../clients/neon.js", () => ({ findDealsWithRenewalDueToday: vi.fn() }));
vi.mock("../clients/hubspot.js", () => ({
  fetchDealStage: vi.fn(),
  VA_ACTIVE_CUSTOMER_DEALSTAGES: ["3668025064", "3102360263", "2462646003"],
}));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));

import { findDealsWithRenewalDueToday } from "../clients/neon.js";
import { fetchDealStage } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { runRenewalCheck } from "../jobs/renewalCron.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDealsWithRenewalDueToday).mockResolvedValue([
    { dealId: "legacy-1", dealName: "Legacy <> VA" },
    { dealId: "monthly-1", dealName: "Monthly <> VA" },
  ]);
  vi.mocked(fetchDealStage).mockResolvedValue("3102360263");
  vi.mocked(runRenewalPipeline).mockResolvedValue({
    billingPeriod: "Quarterly-2026-10-01",
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

describe("runRenewalCheck (legacy due-date flow)", () => {
  it("queries Neon for the IST date and never bills a deal the monthly cycle owns", async () => {
    await runRenewalCheck(new Set(["monthly-1"]), new Date("2026-09-30T18:30:00Z"));

    expect(findDealsWithRenewalDueToday).toHaveBeenCalledWith("2026-10-01");
    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => c[1])).toEqual(["legacy-1"]);
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toBeUndefined();
  });

  it("still skips deals that are not in an active-customer stage", async () => {
    vi.mocked(fetchDealStage).mockResolvedValue("3128528610");

    await runRenewalCheck(new Set(), new Date("2026-10-01T05:30:00Z"));

    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });
});
