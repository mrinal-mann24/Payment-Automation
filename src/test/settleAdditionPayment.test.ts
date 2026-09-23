import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../repositories/additionCharges.js", () => ({
  claimAdditionPayment: vi.fn(),
  findAdditionChargeById: vi.fn(),
  recordAdditionDuplicatePayment: vi.fn(),
}));
vi.mock("../clients/razorpay.js", () => ({ cancelPaymentLink: vi.fn() }));
vi.mock("../steps/convertAdditionInvoice.js", () => ({ convertAdditionInvoice: vi.fn() }));
vi.mock("../steps/recordZohoPayment.js", () => ({ recordAdditionZohoPayment: vi.fn() }));
vi.mock("../steps/sendAdditionPaymentConfirmation.js", () => ({ sendAdditionPaymentConfirmation: vi.fn() }));
vi.mock("../steps/sendAdditionInvoiceEmail.js", () => ({ sendAdditionInvoiceEmail: vi.fn() }));

import {
  claimAdditionPayment,
  findAdditionChargeById,
  recordAdditionDuplicatePayment,
  type AdditionCharge,
} from "../repositories/additionCharges.js";
import { cancelPaymentLink } from "../clients/razorpay.js";
import { convertAdditionInvoice } from "../steps/convertAdditionInvoice.js";
import { recordAdditionZohoPayment } from "../steps/recordZohoPayment.js";
import { sendAdditionPaymentConfirmation } from "../steps/sendAdditionPaymentConfirmation.js";
import { sendAdditionInvoiceEmail } from "../steps/sendAdditionInvoiceEmail.js";
import { settleAdditionPayment } from "../steps/settleAdditionPayment.js";
import { SettlementInProgressError } from "../steps/settleRenewalPayment.js";

const fakeSupabase = {} as SupabaseClient;

const charge: AdditionCharge = {
  id: "add-1",
  hubspot_deal_id: "deal-1",
  amount: 8000,
  description: "GST filing",
  narration: null,
  zoho_estimate_id: "zest-9",
  zoho_estimate_number: "QT-9",
  zoho_estimate_total: 8640,
  razorpay_payment_link_id: "plink-9",
  razorpay_short_url: "https://rzp.io/i/9",
  status: "done",
  zoho_invoice_id: null,
  zoho_invoice_number: null,
  invoice_step_status: "pending",
  periskope_payment_confirmed_sent: false,
  periskope_sent: true,
  periskope_skip_reason: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  paid_at: null,
  payment_method: null,
  payment_amount: null,
  payment_date: null,
  payment_narration: null,
  payment_reference: null,
  zoho_payment_id: null,
  created_at: "2026-10-01T05:30:00Z",
  updated_at: "2026-10-01T05:30:00Z",
};

const paidByRazorpay = { ...charge, paid_at: "2026-10-03T04:00:00Z", payment_method: "razorpay", payment_reference: "pay_1" };

const razorpayPayment = { method: "razorpay" as const, amount: 8640, paymentDate: "2026-10-03", narration: null, reference: "pay_1" };
const yesBankPayment = { method: "yes_bank" as const, amount: 8640, paymentDate: "2026-10-03", narration: "NEFT ref 123", reference: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimAdditionPayment).mockResolvedValue(true);
  vi.mocked(findAdditionChargeById).mockResolvedValue(paidByRazorpay);
  vi.mocked(cancelPaymentLink).mockResolvedValue("cancelled");
  vi.mocked(convertAdditionInvoice).mockResolvedValue({ invoiceId: "zinv-9", invoiceNumber: "INV-9" });
  vi.mocked(recordAdditionZohoPayment).mockResolvedValue("zpay-9");
  vi.mocked(sendAdditionPaymentConfirmation).mockResolvedValue({ sent: true, skipReason: null });
  vi.mocked(sendAdditionInvoiceEmail).mockResolvedValue({ sent: true, error: null });
});

describe("settleAdditionPayment", () => {
  it("a Yes Bank payment cancels the Razorpay link, then invoices, records the Zoho payment, confirms on WhatsApp and emails the invoice", async () => {
    const result = await settleAdditionPayment(fakeSupabase, charge, yesBankPayment);

    expect(claimAdditionPayment).toHaveBeenCalledWith(fakeSupabase, "add-1", yesBankPayment);
    expect(cancelPaymentLink).toHaveBeenCalledWith("plink-9");
    expect(vi.mocked(cancelPaymentLink).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(convertAdditionInvoice).mock.invocationCallOrder[0]!,
    );
    expect(convertAdditionInvoice).toHaveBeenCalledWith(fakeSupabase, "QT-9");
    expect(recordAdditionZohoPayment).toHaveBeenCalledWith(fakeSupabase, "QT-9");
    expect(vi.mocked(recordAdditionZohoPayment).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendAdditionPaymentConfirmation).mock.invocationCallOrder[0]!,
    );
    expect(sendAdditionPaymentConfirmation).toHaveBeenCalledWith(fakeSupabase, "QT-9");
    expect(sendAdditionInvoiceEmail).toHaveBeenCalledWith(fakeSupabase, "QT-9");
    expect(result).toMatchObject({
      chargeId: "add-1",
      estimateNumber: "QT-9",
      recordedPayment: true,
      alreadyPaid: false,
      paidVia: "yes_bank",
      invoiceNumber: "INV-9",
      zohoPaymentRecorded: true,
      whatsappSent: true,
      emailSent: true,
      errors: [],
    });
  });

  it("a Razorpay payment (webhook or admin) leaves the link alone", async () => {
    const result = await settleAdditionPayment(fakeSupabase, charge, razorpayPayment);

    expect(cancelPaymentLink).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recordedPayment: true, invoiceNumber: "INV-9", errors: [] });
  });

  it("a Zoho payment failure is reported but does not block the confirmation or the email", async () => {
    vi.mocked(recordAdditionZohoPayment).mockRejectedValueOnce(new Error("Zoho Books API error 401"));

    const result = await settleAdditionPayment(fakeSupabase, charge, yesBankPayment);

    expect(sendAdditionPaymentConfirmation).toHaveBeenCalled();
    expect(sendAdditionInvoiceEmail).toHaveBeenCalled();
    expect(result).toMatchObject({ zohoPaymentRecorded: false, whatsappSent: true, emailSent: true });
    expect(result.errors).toEqual(["zoho payment: Zoho Books API error 401"]);
  });

  it("a duplicate delivery loses the claim, records nothing new, and still completes the unfinished steps", async () => {
    vi.mocked(claimAdditionPayment).mockResolvedValue(false);

    const result = await settleAdditionPayment(fakeSupabase, charge, razorpayPayment);

    expect(result).toMatchObject({ recordedPayment: false, alreadyPaid: true, paidVia: "razorpay" });
    expect(recordAdditionDuplicatePayment).not.toHaveBeenCalled();
    expect(convertAdditionInvoice).toHaveBeenCalled();
  });

  it("flags a genuine second payment (different method) instead of silently dropping it", async () => {
    vi.mocked(claimAdditionPayment).mockResolvedValue(false);

    await settleAdditionPayment(fakeSupabase, charge, yesBankPayment);

    expect(recordAdditionDuplicatePayment).toHaveBeenCalledWith(fakeSupabase, "add-1", yesBankPayment);
    expect(cancelPaymentLink).not.toHaveBeenCalled();
  });

  it("the daily sweep (no payment details) only re-runs the outstanding steps", async () => {
    const result = await settleAdditionPayment(fakeSupabase, paidByRazorpay, null);

    expect(claimAdditionPayment).not.toHaveBeenCalled();
    expect(convertAdditionInvoice).toHaveBeenCalled();
    expect(result).toMatchObject({ recordedPayment: false, alreadyPaid: true, paidVia: "razorpay", errors: [] });
  });

  it("refuses a quote that was never sent", async () => {
    await expect(
      settleAdditionPayment(fakeSupabase, { ...charge, status: "pending", zoho_estimate_id: null }, yesBankPayment),
    ).rejects.toThrow(/no quote/);
    expect(claimAdditionPayment).not.toHaveBeenCalled();
  });

  it("rejects an overlapping settlement of the same quote", async () => {
    let finish!: () => void;
    vi.mocked(convertAdditionInvoice).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ invoiceId: "zinv-9", invoiceNumber: "INV-9" });
      }),
    );

    const first = settleAdditionPayment(fakeSupabase, charge, razorpayPayment);
    await expect(settleAdditionPayment(fakeSupabase, charge, razorpayPayment)).rejects.toBeInstanceOf(
      SettlementInProgressError,
    );
    finish();
    await first;
  });
});
