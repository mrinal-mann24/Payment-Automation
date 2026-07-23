import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  fetchDealWithLineItemsAndContact: vi.fn(),
}));
vi.mock("../clients/zoho.js", () => ({
  getInvoicePdf: vi.fn(),
}));
vi.mock("../clients/periskope.js", () => ({
  sendDocumentMessage: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markPaymentConfirmedSent: vi.fn(),
  markPaymentConfirmedSkipped: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getInvoicePdf } from "../clients/zoho.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  findRenewalJob,
  markPaymentConfirmedSent,
  markPaymentConfirmedSkipped,
} from "../repositories/renewalJobs.js";
import { sendPaymentConfirmation } from "./sendPaymentConfirmation.js";

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
  zoho_invoice_id: "zinv-123",
  zoho_invoice_number: "INV-000123",
  invoice_step_status: "done" as const,
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

const fakeDeal = {
  dealId: "deal-1",
  dealName: "Renewal",
  billingPeriod: "2026-07",
  contactEmail: "client@example.com",
  contactName: "Client Name",
  contactPhone: "919876543210",
  lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 1000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendPaymentConfirmation", () => {
  it("refuses to run when invoice_step_status is not done", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, invoice_step_status: "pending" });

    await expect(sendPaymentConfirmation(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /invoice_step_status is not "done"/,
    );
    expect(fetchDealWithLineItemsAndContact).not.toHaveBeenCalled();
  });

  it("skips sending and records a reason when no WhatsApp identifier is found (REQ-4.9)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal, contactPhone: null });

    const result = await sendPaymentConfirmation(fakeSupabase, "deal-1", "2026-07");

    expect(result.sent).toBe(false);
    expect(result.skipReason).toMatch(/No WhatsApp identifier/);
    expect(markPaymentConfirmedSkipped).toHaveBeenCalledWith(fakeSupabase, "job-1", expect.any(String));
    expect(sendDocumentMessage).not.toHaveBeenCalled();
  });

  it("sends the invoice PDF and marks the job sent (REQ-4.8)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal });
    vi.mocked(getInvoicePdf).mockResolvedValue(Buffer.from("pdf-bytes"));

    const result = await sendPaymentConfirmation(fakeSupabase, "deal-1", "2026-07");

    expect(result.sent).toBe(true);
    expect(getInvoicePdf).toHaveBeenCalledWith("zinv-123");
    expect(sendDocumentMessage).toHaveBeenCalledWith(
      "919876543210",
      expect.stringContaining("INV-000123"),
      expect.objectContaining({ filename: "INV-000123.pdf", mimetype: "application/pdf" }),
    );
    expect(markPaymentConfirmedSent).toHaveBeenCalledWith(fakeSupabase, "job-1");
  });

  it("is idempotent: does not resend when periskope_payment_confirmed_sent is already true", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, periskope_payment_confirmed_sent: true });

    const result = await sendPaymentConfirmation(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ sent: true, skipReason: null });
    expect(sendDocumentMessage).not.toHaveBeenCalled();
  });
});
