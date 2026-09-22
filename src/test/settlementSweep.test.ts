import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../repositories/renewalJobs.js", () => ({ findPaidUnsettledJobs: vi.fn() }));
vi.mock("../steps/settleRenewalPayment.js", () => ({ settleRenewalPayment: vi.fn() }));

import { findPaidUnsettledJobs } from "../repositories/renewalJobs.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { runSettlementSweep } from "../jobs/settlementSweep.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSettlementSweep", () => {
  it("re-settles every paid-but-unfinished cycle with no payment details and keeps going when one fails", async () => {
    vi.mocked(findPaidUnsettledJobs).mockResolvedValue([
      { id: "a", hubspot_deal_id: "deal-a", billing_period: "2026-10" } as never,
      { id: "b", hubspot_deal_id: "deal-b", billing_period: "2026-10" } as never,
    ]);
    vi.mocked(settleRenewalPayment).mockRejectedValueOnce(new Error("Zoho down"));

    await runSettlementSweep();

    expect(vi.mocked(settleRenewalPayment).mock.calls.map((c) => [c[1].id, c[2]])).toEqual([
      ["a", null],
      ["b", null],
    ]);
  });
});
