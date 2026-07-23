import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  fetchDealWithLineItemsAndContact: vi.fn(),
}));
vi.mock("../clients/zoho.js", () => ({
  getEstimatePdf: vi.fn(),
}));
vi.mock("../clients/periskope.js", () => ({
  sendDocumentMessage: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markPeriskopeSent: vi.fn(),
  markPeriskopeSkipped: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getEstimatePdf } from "../clients/zoho.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  findRenewalJob,
  markPeriskopeSent,
  markPeriskopeSkipped,
} from "../repositories/renewalJobs.js";
import { sendRenewalMessage } from "./sendRenewalMessage.js";

const fakeSupabase = {} as SupabaseClient;

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-07",
  status: "in_progress" as const,
  zoho_estimate_id: "zest-123",
  zoho_estimate_number: "EST-000123",
  zoho_estimate_total: 1000,
  zoho_step_status: "done" as const,
  razorpay_payment_link_id: "plink-1",
  razorpay_short_url: "https://rzp.io/i/1",
  razorpay_step_status: "done" as const,
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

describe("sendRenewalMessage", () => {
  it("refuses to run when razorpay_step_status is not done (REQ-3.1)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, razorpay_step_status: "pending" });

    await expect(sendRenewalMessage(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /razorpay_step_status is not "done"/,
    );
    expect(fetchDealWithLineItemsAndContact).not.toHaveBeenCalled();
  });

  it("skips sending and records a reason when no WhatsApp identifier is found (REQ-3.4)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal, contactPhone: null });

    const result = await sendRenewalMessage(fakeSupabase, "deal-1", "2026-07");

    expect(result.sent).toBe(false);
    expect(result.skipReason).toMatch(/No WhatsApp identifier/);
    expect(markPeriskopeSkipped).toHaveBeenCalledWith(fakeSupabase, "job-1", expect.any(String));
    expect(sendDocumentMessage).not.toHaveBeenCalled();
  });

  it("sends the estimate PDF and payment link, then marks the job sent (REQ-3.3)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal });
    vi.mocked(getEstimatePdf).mockResolvedValue(Buffer.from("pdf-bytes"));

    const result = await sendRenewalMessage(fakeSupabase, "deal-1", "2026-07");

    expect(result.sent).toBe(true);
    expect(getEstimatePdf).toHaveBeenCalledWith("zest-123");
    expect(sendDocumentMessage).toHaveBeenCalledWith(
      "919876543210",
      expect.stringContaining("https://rzp.io/i/1"),
      expect.objectContaining({ filename: "EST-000123.pdf", mimetype: "application/pdf" }),
    );
    expect(markPeriskopeSent).toHaveBeenCalledWith(fakeSupabase, "job-1");
  });

  it("is idempotent: does not resend when periskope_sent is already true", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, periskope_sent: true });

    const result = await sendRenewalMessage(fakeSupabase, "deal-1", "2026-07");

    expect(result).toEqual({ sent: true, skipReason: null });
    expect(sendDocumentMessage).not.toHaveBeenCalled();
  });

  it("is idempotent: does not retry when already skipped with a recorded reason", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...baseJob,
      periskope_skip_reason: "No WhatsApp identifier (contact phone) found for deal deal-1",
    });

    const result = await sendRenewalMessage(fakeSupabase, "deal-1", "2026-07");

    expect(result.sent).toBe(false);
    expect(fetchDealWithLineItemsAndContact).not.toHaveBeenCalled();
  });
});
