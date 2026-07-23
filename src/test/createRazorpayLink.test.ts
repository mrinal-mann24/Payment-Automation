import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/razorpay.js", () => ({
  createPaymentLink: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markRazorpayStepDone: vi.fn(),
  markRazorpayStepFailed: vi.fn(),
}));

import { createPaymentLink } from "../clients/razorpay.js";
import {
  findRenewalJob,
  markRazorpayStepDone,
  markRazorpayStepFailed,
} from "../repositories/renewalJobs.js";
import { createRazorpayLink } from "./createRazorpayLink.js";

const fakeSupabase = {} as SupabaseClient;

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-07",
  status: "done" as const,
  zoho_estimate_id: "zest-123",
  zoho_estimate_number: "EST-000123",
  zoho_estimate_total: 1000,
  zoho_step_status: "done" as const,
  razorpay_payment_link_id: null,
  razorpay_short_url: null,
  razorpay_step_status: "pending" as const,
  periskope_sent: false,
  periskope_skip_reason: null,
  hubspot_updated: false,
  zoho_invoice_id: null,
  zoho_invoice_number: null,
  invoice_step_status: "pending" as const,
  periskope_payment_confirmed_sent: false,
  hubspot_renewal_done: false,
  reminder_1_sent_at: null,
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
  reminder_skip_reason: null,
  error_log: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createRazorpayLink", () => {
  it("skips creating a link and reuses the stored one when the job is already done", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...baseJob,
      razorpay_step_status: "done",
      razorpay_payment_link_id: "plink-existing",
      razorpay_short_url: "https://rzp.io/i/existing",
    });

    const result = await createRazorpayLink(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ paymentLinkId: "plink-existing", shortUrl: "https://rzp.io/i/existing" });
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("refuses to run when zoho_step_status is not done (REQ-2.1)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...baseJob,
      zoho_step_status: "pending",
    });

    await expect(createRazorpayLink(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /zoho_step_status is not "done"/,
    );
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("records the error on renewal_jobs and halts when the Razorpay API call fails (REQ-2.5)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(createPaymentLink).mockRejectedValue(new Error("Razorpay API error 500: boom"));

    await expect(createRazorpayLink(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      "Razorpay API error 500: boom",
    );

    expect(markRazorpayStepFailed).toHaveBeenCalledWith(fakeSupabase, "job-1", "Razorpay API error 500: boom");
    expect(markRazorpayStepDone).not.toHaveBeenCalled();
  });

  it("writes payment_link_id and short_url to renewal_jobs on success (REQ-2.4)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(createPaymentLink).mockResolvedValue({
      paymentLinkId: "plink-new",
      shortUrl: "https://rzp.io/i/new",
    });

    const result = await createRazorpayLink(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ paymentLinkId: "plink-new", shortUrl: "https://rzp.io/i/new" });
    expect(createPaymentLink).toHaveBeenCalledWith("EST-000123", 100000, expect.any(String));
    expect(markRazorpayStepDone).toHaveBeenCalledWith(
      fakeSupabase,
      "job-1",
      "plink-new",
      "https://rzp.io/i/new",
    );
  });
});
