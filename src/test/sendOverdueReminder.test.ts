import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  fetchDealWithLineItemsAndContact: vi.fn(),
}));
vi.mock("../clients/periskope.js", () => ({
  sendTextMessage: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markReminderSent: vi.fn(),
  markReminderSkipped: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { sendTextMessage } from "../clients/periskope.js";
import { findRenewalJob, markReminderSent, markReminderSkipped } from "../repositories/renewalJobs.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";

const fakeSupabase = {} as SupabaseClient;

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "Monthly-2026-07-10",
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

const fakeDeal = {
  dealId: "deal-1",
  dealName: "Renewal",
  billingPeriod: "Monthly-2026-07-10",
  contactEmail: "client@example.com",
  contactName: "Client Name",
  contactPhone: "919876543210",
  lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 1000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendOverdueReminder", () => {
  it("refuses to run when razorpay_step_status is not done (REQ-5.1)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, razorpay_step_status: "pending" });

    await expect(sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 1)).rejects.toThrow(
      /razorpay_step_status is not "done"/,
    );
    expect(fetchDealWithLineItemsAndContact).not.toHaveBeenCalled();
  });

  it("does nothing once invoice_step_status is done (REQ-5.7)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, invoice_step_status: "done" });

    const result = await sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 1);

    expect(result).toEqual({ sent: false, skipReason: null });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("skips sending and records a reason when no WhatsApp identifier is found (REQ-5.5)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal, contactPhone: null });

    const result = await sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 1);

    expect(result.sent).toBe(false);
    expect(result.skipReason).toMatch(/No WhatsApp identifier/);
    expect(markReminderSkipped).toHaveBeenCalledWith(fakeSupabase, "job-1", expect.any(String));
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("sends reminder 1 and marks it sent (REQ-5.2)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal });

    const result = await sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 1);

    expect(result).toEqual({ sent: true, skipReason: null });
    expect(sendTextMessage).toHaveBeenCalledWith("919876543210", expect.stringContaining("https://rzp.io/i/1"));
    expect(markReminderSent).toHaveBeenCalledWith(fakeSupabase, "job-1", 1);
  });

  it("sends reminder 3 with a discontinuation notice (REQ-5.4)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal });

    await sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 3);

    expect(sendTextMessage).toHaveBeenCalledWith(
      "919876543210",
      expect.stringMatching(/discontinued/i),
    );
    expect(markReminderSent).toHaveBeenCalledWith(fakeSupabase, "job-1", 3);
  });

  it("is idempotent: does not resend a stage that's already sent (REQ-5.6)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...baseJob,
      reminder_1_sent_at: "2026-07-12T06:00:00Z",
    });

    const result = await sendOverdueReminder(fakeSupabase, "deal-1", "Monthly-2026-07-10", 1);

    expect(result).toEqual({ sent: true, skipReason: null });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
