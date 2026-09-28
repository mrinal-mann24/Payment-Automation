import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../clients/neon.js", () => ({ findDealsWithRenewalDue: vi.fn() }));
vi.mock("../clients/hubspot.js", () => ({
  fetchDealStage: vi.fn(),
  VA_ACTIVE_CUSTOMER_DEALSTAGES: ["3668025064", "3102360263", "2462646003"],
}));
vi.mock("../jobs/renewalPipeline.js", () => ({ runRenewalPipeline: vi.fn() }));
vi.mock("../repositories/renewalJobs.js", () => ({ findRecentLegacyJob: vi.fn() }));

import { findDealsWithRenewalDue } from "../clients/neon.js";
import { fetchDealStage } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { findRecentLegacyJob } from "../repositories/renewalJobs.js";
import { runRenewalCheck } from "../jobs/renewalCron.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDealsWithRenewalDue).mockResolvedValue([
    { dealId: "legacy-1", dealName: "Legacy <> VA" },
    { dealId: "monthly-1", dealName: "Monthly <> VA" },
  ]);
  vi.mocked(fetchDealStage).mockResolvedValue("3102360263");
  vi.mocked(findRecentLegacyJob).mockResolvedValue(null);
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
  it("queries Neon for the IST date with a four-day catch-up window and never bills a deal the monthly cycle owns", async () => {
    await runRenewalCheck(new Set(["monthly-1"]), new Date("2026-09-30T18:30:00Z"));

    expect(findDealsWithRenewalDue).toHaveBeenCalledWith("2026-10-01", 4);
    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => c[1])).toEqual(["legacy-1"]);
    expect(vi.mocked(runRenewalPipeline).mock.calls[0]![2]).toBeUndefined();
  });

  it("still skips deals that are not in an active-customer stage", async () => {
    vi.mocked(fetchDealStage).mockResolvedValue("3128528610");

    await runRenewalCheck(new Set(), new Date("2026-10-01T05:30:00Z"));

    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });
});

describe("runRenewalCheck — catch-up window", () => {
  it("does not quote again a deal whose legacy quote from the last four days is already paid", async () => {
    vi.mocked(findRecentLegacyJob).mockResolvedValue({
      id: "job-9",
      billing_period: "Annual-2026-10-01",
      zoho_estimate_number: "QT-9",
      paid_at: "2026-10-01T06:00:00Z",
    } as never);

    await runRenewalCheck(new Set(["monthly-1"]), new Date("2026-10-02T05:30:00Z"));

    expect(findRecentLegacyJob).toHaveBeenCalledWith({}, "legacy-1", "2026-09-29");
    expect(runRenewalPipeline).not.toHaveBeenCalled();
  });

  it("resumes a legacy quote from the window that is still unpaid", async () => {
    vi.mocked(findRecentLegacyJob).mockResolvedValue({ id: "job-9", billing_period: "Annual-2026-10-01", paid_at: null } as never);

    await runRenewalCheck(new Set(["monthly-1"]), new Date("2026-10-02T05:30:00Z"));

    expect(vi.mocked(runRenewalPipeline).mock.calls.map((c) => c[1])).toEqual(["legacy-1"]);
  });
});
