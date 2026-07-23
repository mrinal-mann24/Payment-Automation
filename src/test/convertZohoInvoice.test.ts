import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/zoho.js", () => ({
  convertEstimateToInvoice: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markInvoiceStepDone: vi.fn(),
  markInvoiceStepFailed: vi.fn(),
}));

import { convertEstimateToInvoice } from "../clients/zoho.js";
import {
  findRenewalJob,
  markInvoiceStepDone,
  markInvoiceStepFailed,
} from "../repositories/renewalJobs.js";
import { convertZohoInvoice } from "./convertZohoInvoice.js";

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
  razorpay_payment_link_id: "plink-1",
  razorpay_short_url: "https://rzp.io/i/1",
  razorpay_step_status: "done" as const,
  periskope_sent: true,
  periskope_skip_reason: null,
  hubspot_updated: true,
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

describe("convertZohoInvoice", () => {
  it("refuses to run when razorpay_step_status is not done", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, razorpay_step_status: "pending" });

    await expect(convertZohoInvoice(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /razorpay_step_status is not "done"/,
    );
    expect(convertEstimateToInvoice).not.toHaveBeenCalled();
  });

  it("skips conversion and reuses the stored invoice when already done (REQ-4.5)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...baseJob,
      invoice_step_status: "done",
      zoho_invoice_id: "zinv-existing",
      zoho_invoice_number: "INV-000123",
    });

    const result = await convertZohoInvoice(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ invoiceId: "zinv-existing", invoiceNumber: "INV-000123" });
    expect(convertEstimateToInvoice).not.toHaveBeenCalled();
  });

  it("converts the estimate and writes the invoice to renewal_jobs on success (REQ-4.6, REQ-4.7)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(convertEstimateToInvoice).mockResolvedValue({
      invoiceId: "zinv-new",
      invoiceNumber: "INV-000124",
    });

    const result = await convertZohoInvoice(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ invoiceId: "zinv-new", invoiceNumber: "INV-000124" });
    expect(convertEstimateToInvoice).toHaveBeenCalledWith("zest-123");
    expect(markInvoiceStepDone).toHaveBeenCalledWith(fakeSupabase, "job-1", "zinv-new", "INV-000124");
  });

  it("records the error on renewal_jobs and halts when the Zoho conversion fails (REQ-4.11)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(convertEstimateToInvoice).mockRejectedValue(new Error("Zoho Books API error 500: boom"));

    await expect(convertZohoInvoice(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      "Zoho Books API error 500: boom",
    );

    expect(markInvoiceStepFailed).toHaveBeenCalledWith(
      fakeSupabase,
      "job-1",
      "Zoho Books API error 500: boom",
    );
    expect(markInvoiceStepDone).not.toHaveBeenCalled();
  });
});
