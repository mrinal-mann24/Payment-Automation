import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../repositories/renewalJobs.js", () => ({
  claimPayment: vi.fn(),
  findRenewalJob: vi.fn(),
  recordDuplicatePayment: vi.fn(),
}));
vi.mock("../clients/razorpay.js", () => ({ cancelPaymentLink: vi.fn() }));
vi.mock("../steps/convertZohoInvoice.js", () => ({ convertZohoInvoice: vi.fn() }));
vi.mock("../steps/sendPaymentConfirmation.js", () => ({ sendPaymentConfirmation: vi.fn() }));
vi.mock("../steps/sendInvoiceEmail.js", () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock("../steps/markRenewalDone.js", () => ({ markRenewalDone: vi.fn() }));

import { claimPayment, findRenewalJob, recordDuplicatePayment } from "../repositories/renewalJobs.js";
import { cancelPaymentLink } from "../clients/razorpay.js";
import { convertZohoInvoice } from "../steps/convertZohoInvoice.js";
import { sendPaymentConfirmation } from "../steps/sendPaymentConfirmation.js";
import { sendInvoiceEmail } from "../steps/sendInvoiceEmail.js";
import { markRenewalDone } from "../steps/markRenewalDone.js";
import { SettlementInProgressError, settleRenewalPayment } from "../steps/settleRenewalPayment.js";

const fakeSupabase = {} as SupabaseClient;

const job = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-10",
  status: "done",
  zoho_estimate_id: "zest-1",
  zoho_estimate_number: "QT-1",
  zoho_estimate_total: 5400,
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
  service_period_start: "2026-10-01",
  billed_price: 5000,
  paid_at: null,
  payment_method: null,
  payment_amount: null,
  payment_date: null,
  payment_narration: null,
  payment_reference: null,
  hubspot_line_item_id: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-01T05:30:00Z",
  updated_at: "2026-10-01T05:30:00Z",
};

const paidByRazorpay = { ...job, paid_at: "2026-10-03T04:00:00Z", payment_method: "razorpay", payment_reference: "pay_1" };

const razorpayPayment = { method: "razorpay" as const, amount: 5400, paymentDate: "2026-10-03", narration: null, reference: "pay_1" };
const yesBankPayment = { method: "yes_bank" as const, amount: 5400, paymentDate: "2026-10-03", narration: "NEFT ref 123", reference: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimPayment).mockResolvedValue(true);
  vi.mocked(findRenewalJob).mockResolvedValue(paidByRazorpay);
  vi.mocked(cancelPaymentLink).mockResolvedValue("cancelled");
  vi.mocked(convertZohoInvoice).mockResolvedValue({ invoiceId: "zinv-1", invoiceNumber: "INV-1" });
  vi.mocked(sendPaymentConfirmation).mockResolvedValue({ sent: true, skipReason: null });
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ sent: true, error: null });
  vi.mocked(markRenewalDone).mockResolvedValue(undefined);
});

describe("settleRenewalPayment", () => {
  it("TEST 1: a Razorpay payment is recorded, invoiced, confirmed on WhatsApp + email and written to HubSpot, without touching the link", async () => {
    const result = await settleRenewalPayment(fakeSupabase, job, razorpayPayment);

    expect(claimPayment).toHaveBeenCalledWith(fakeSupabase, "job-1", razorpayPayment);
    expect(cancelPaymentLink).not.toHaveBeenCalled();
    expect(convertZohoInvoice).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(sendPaymentConfirmation).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(sendInvoiceEmail).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(markRenewalDone).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(result).toMatchObject({
      recordedPayment: true,
      alreadyPaid: false,
      invoiceNumber: "INV-1",
      whatsappSent: true,
      emailSent: true,
      hubspotDone: true,
      errors: [],
    });
  });

  it("TEST 2: a Yes Bank payment cancels the Razorpay link first, then settles exactly like a Razorpay payment", async () => {
    const result = await settleRenewalPayment(fakeSupabase, job, yesBankPayment);

    expect(cancelPaymentLink).toHaveBeenCalledWith("plink-1");
    expect(vi.mocked(cancelPaymentLink).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(convertZohoInvoice).mock.invocationCallOrder[0]!,
    );
    expect(markRenewalDone).toHaveBeenCalled();
    expect(result).toMatchObject({ recordedPayment: true, hubspotDone: true, errors: [] });
  });

  it("still settles when cancelling the link fails or it was already paid", async () => {
    vi.mocked(cancelPaymentLink).mockRejectedValueOnce(new Error("Razorpay API error 500"));

    const result = await settleRenewalPayment(fakeSupabase, job, yesBankPayment);

    expect(result).toMatchObject({ recordedPayment: true, hubspotDone: true, errors: [] });
  });

  it("TEST 10: a duplicate delivery loses the claim, records nothing new, and still completes unfinished steps", async () => {
    vi.mocked(claimPayment).mockResolvedValue(false);

    const result = await settleRenewalPayment(fakeSupabase, job, razorpayPayment);

    expect(result).toMatchObject({ recordedPayment: false, alreadyPaid: true, paidVia: "razorpay" });
    expect(recordDuplicatePayment).not.toHaveBeenCalled();
    expect(convertZohoInvoice).toHaveBeenCalled();
  });

  it("flags a genuine second payment (different method) instead of silently dropping it", async () => {
    vi.mocked(claimPayment).mockResolvedValue(false);

    await settleRenewalPayment(fakeSupabase, job, yesBankPayment);

    expect(recordDuplicatePayment).toHaveBeenCalledWith(fakeSupabase, "job-1", yesBankPayment);
    expect(cancelPaymentLink).not.toHaveBeenCalled();
  });

  it("keeps the payment recorded and reports the error when the invoice conversion fails", async () => {
    vi.mocked(convertZohoInvoice).mockRejectedValue(new Error("Zoho Books API error 500: boom"));

    const result = await settleRenewalPayment(fakeSupabase, job, razorpayPayment);

    expect(result.recordedPayment).toBe(true);
    expect(result.errors).toEqual([expect.stringMatching(/invoice.*500/)]);
    expect(sendPaymentConfirmation).not.toHaveBeenCalled();
    expect(markRenewalDone).not.toHaveBeenCalled();
  });

  it("still emails and updates HubSpot when the WhatsApp confirmation throws", async () => {
    vi.mocked(sendPaymentConfirmation).mockRejectedValue(new Error("Periskope API error 500"));

    const result = await settleRenewalPayment(fakeSupabase, job, razorpayPayment);

    expect(sendInvoiceEmail).toHaveBeenCalled();
    expect(markRenewalDone).toHaveBeenCalled();
    expect(result.errors).toEqual([expect.stringMatching(/whatsapp.*Periskope/i)]);
  });

  it("rejects an overlapping settlement of the same cycle and accepts it again once the first finishes", async () => {
    let release: (value: { invoiceId: string; invoiceNumber: string }) => void = () => {};
    vi.mocked(convertZohoInvoice).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const first = settleRenewalPayment(fakeSupabase, job, razorpayPayment);
    await expect(settleRenewalPayment(fakeSupabase, job, razorpayPayment)).rejects.toBeInstanceOf(
      SettlementInProgressError,
    );

    release({ invoiceId: "zinv-1", invoiceNumber: "INV-1" });
    await first;
    await expect(settleRenewalPayment(fakeSupabase, job, null)).resolves.toMatchObject({ errors: [] });
  });

  it("re-runs only the unfinished steps when called with no payment (daily sweep)", async () => {
    await settleRenewalPayment(fakeSupabase, paidByRazorpay, null);

    expect(claimPayment).not.toHaveBeenCalled();
    expect(cancelPaymentLink).not.toHaveBeenCalled();
    expect(convertZohoInvoice).toHaveBeenCalled();
    expect(markRenewalDone).toHaveBeenCalled();
  });

  it("refuses a payment against a cycle that has no quote", async () => {
    await expect(settleRenewalPayment(fakeSupabase, { ...job, zoho_estimate_id: null }, yesBankPayment)).rejects.toThrow(
      /no quote/,
    );
    expect(claimPayment).not.toHaveBeenCalled();
  });
});
