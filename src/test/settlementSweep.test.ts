import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../repositories/renewalJobs.js", () => ({ findPaidUnsettledJobs: vi.fn() }));
vi.mock("../repositories/additionCharges.js", () => ({ findPaidUnsettledAdditionCharges: vi.fn() }));
vi.mock("../steps/settleRenewalPayment.js", () => ({ settleRenewalPayment: vi.fn() }));
vi.mock("../steps/settleAdditionPayment.js", () => ({ settleAdditionPayment: vi.fn() }));

import { findPaidUnsettledJobs } from "../repositories/renewalJobs.js";
import { findPaidUnsettledAdditionCharges } from "../repositories/additionCharges.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { settleAdditionPayment } from "../steps/settleAdditionPayment.js";
import { runSettlementSweep } from "../jobs/settlementSweep.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findPaidUnsettledJobs).mockResolvedValue([]);
  vi.mocked(findPaidUnsettledAdditionCharges).mockResolvedValue([]);
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

  it("re-settles every paid-but-unfinished one-time quote the same way", async () => {
    vi.mocked(findPaidUnsettledAdditionCharges).mockResolvedValue([
      { id: "add-1", hubspot_deal_id: "deal-a", zoho_estimate_number: "QT-1" } as never,
      { id: "add-2", hubspot_deal_id: "deal-b", zoho_estimate_number: "QT-2" } as never,
    ]);
    vi.mocked(settleAdditionPayment).mockRejectedValueOnce(new Error("Zoho down"));

    await runSettlementSweep();

    expect(vi.mocked(settleAdditionPayment).mock.calls.map((c) => [c[1].id, c[2]])).toEqual([
      ["add-1", null],
      ["add-2", null],
    ]);
  });
});
