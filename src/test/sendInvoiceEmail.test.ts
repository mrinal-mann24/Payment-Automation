import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  fetchDealWithLineItemsAndContact: vi.fn(),
}));
vi.mock("../clients/zoho.js", () => ({
  emailInvoice: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markInvoiceEmailSent: vi.fn(),
  markEmailError: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { emailInvoice } from "../clients/zoho.js";
import { findRenewalJob, markEmailError, markInvoiceEmailSent } from "../repositories/renewalJobs.js";
import { sendInvoiceEmail } from "../steps/sendInvoiceEmail.js";

const fakeSupabase = {} as SupabaseClient;

const paidJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-10",
  status: "done",
  zoho_estimate_id: "zest-123",
  zoho_estimate_number: "QT-000123",
  zoho_estimate_total: 5400,
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
  periskope_payment_confirmed_sent: true,
  hubspot_renewal_done: false,
  reminder_1_sent_at: null,
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
  reminder_skip_reason: null,
  service_period_start: "2026-10-01",
  billed_price: 5000,
  paid_at: "2026-10-03T04:00:00Z",
  payment_method: "razorpay",
  payment_amount: 5400,
  payment_date: "2026-10-03",
  payment_narration: null,
  payment_reference: "pay_1",
  hubspot_line_item_id: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-01T05:30:00Z",
  updated_at: "2026-10-03T04:00:00Z",
};

const fakeDeal = {
  dealId: "deal-1",
  dealName: "Acme <> VA",
  billingPeriod: null,
  contactEmail: "client@example.com",
  contactName: "Client Name",
  contactPhone: "919876543210",
  lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 5000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue(fakeDeal);
});

describe("sendInvoiceEmail", () => {
  it("emails the invoice to the HubSpot contact and marks it sent", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob });

    const result = await sendInvoiceEmail(fakeSupabase, "deal-1", "2026-10");

    expect(result).toEqual({ sent: true, error: null });
    expect(emailInvoice).toHaveBeenCalledWith("zinv-123", {
      to: "client@example.com",
      subject: expect.stringContaining("INV-000123"),
      body: expect.stringContaining("INV-000123"),
    });
    expect(markInvoiceEmailSent).toHaveBeenCalledWith(fakeSupabase, "job-1");
  });

  it("is idempotent once invoice_email_sent is set", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob, invoice_email_sent: true });

    await sendInvoiceEmail(fakeSupabase, "deal-1", "2026-10");

    expect(emailInvoice).not.toHaveBeenCalled();
  });

  it("does nothing until the invoice exists", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob, invoice_step_status: "pending", zoho_invoice_id: null });

    const result = await sendInvoiceEmail(fakeSupabase, "deal-1", "2026-10");

    expect(result.sent).toBe(false);
    expect(emailInvoice).not.toHaveBeenCalled();
  });

  it("records the error and returns instead of throwing when Zoho rejects the email", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob });
    vi.mocked(emailInvoice).mockRejectedValue(new Error("Zoho Books API error 500: boom"));

    const result = await sendInvoiceEmail(fakeSupabase, "deal-1", "2026-10");

    expect(result).toEqual({ sent: false, error: "Zoho Books API error 500: boom" });
    expect(markEmailError).toHaveBeenCalledWith(fakeSupabase, "job-1", expect.stringMatching(/500/));
  });
});
