import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/zoho.js", () => ({ recordInvoicePayment: vi.fn() }));
vi.mock("../repositories/renewalJobs.js", () => ({ findRenewalJob: vi.fn(), saveZohoPaymentId: vi.fn() }));
vi.mock("../repositories/additionCharges.js", () => ({
  findAdditionChargeByEstimateNumber: vi.fn(),
  saveAdditionZohoPaymentId: vi.fn(),
}));

import { recordInvoicePayment } from "../clients/zoho.js";
import { findRenewalJob, saveZohoPaymentId } from "../repositories/renewalJobs.js";
import { findAdditionChargeByEstimateNumber, saveAdditionZohoPaymentId } from "../repositories/additionCharges.js";
import { recordAdditionZohoPayment, recordZohoPayment } from "../steps/recordZohoPayment.js";

const fakeSupabase = {} as SupabaseClient;

const paidJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-10-01",
  invoice_step_status: "done",
  zoho_invoice_id: "zinv-1",
  zoho_payment_id: null,
  payment_method: "yes_bank",
  payment_date: "2026-10-03",
  payment_reference: "UTR 123",
  payment_narration: "NEFT from Acme",
};

const paidCharge = {
  id: "add-1",
  zoho_estimate_number: "QT-9",
  invoice_step_status: "done",
  zoho_invoice_id: "zinv-9",
  zoho_payment_id: null,
  payment_method: "razorpay",
  payment_date: "2026-10-05",
  payment_reference: "pay_1",
  payment_narration: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordInvoicePayment).mockResolvedValue({ paymentId: "zpay-1", alreadyPaid: false });
});

describe("recordZohoPayment (billing cycle)", () => {
  it("records a Yes Bank payment as a bank transfer against the cycle's invoice and stores the payment id", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue(paidJob as never);

    expect(await recordZohoPayment(fakeSupabase, "deal-1", "2026-10-01")).toBe("zpay-1");

    expect(recordInvoicePayment).toHaveBeenCalledWith("zinv-1", {
      mode: "banktransfer",
      date: "2026-10-03",
      reference: "UTR 123",
      description: "Paid via Yes Bank: NEFT from Acme",
    });
    expect(saveZohoPaymentId).toHaveBeenCalledWith(fakeSupabase, "job-1", "zpay-1");
  });

  it("maps every payment method to a Zoho payment mode", async () => {
    const expected: Record<string, [string, string]> = {
      razorpay: ["others", "Paid via Razorpay"],
      yes_bank: ["banktransfer", "Paid via Yes Bank"],
      neft: ["banktransfer", "Paid via NEFT"],
      upi: ["others", "Paid via UPI"],
      cheque: ["check", "Paid via Cheque"],
      cash: ["cash", "Paid via Cash"],
      other: ["others", "Paid via Other"],
    };
    for (const [method, [mode, description]] of Object.entries(expected)) {
      vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob, payment_method: method, payment_narration: null } as never);

      await recordZohoPayment(fakeSupabase, "deal-1", "2026-10-01");

      expect(recordInvoicePayment).toHaveBeenLastCalledWith("zinv-1", expect.objectContaining({ mode, description }));
    }
  });

  it("does nothing when the payment is already recorded in Zoho", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob, zoho_payment_id: "zpay-0" } as never);

    expect(await recordZohoPayment(fakeSupabase, "deal-1", "2026-10-01")).toBe("zpay-0");

    expect(recordInvoicePayment).not.toHaveBeenCalled();
    expect(saveZohoPaymentId).not.toHaveBeenCalled();
  });

  it("refuses a cycle whose invoice does not exist yet", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...paidJob, invoice_step_status: "pending", zoho_invoice_id: null } as never);

    await expect(recordZohoPayment(fakeSupabase, "deal-1", "2026-10-01")).rejects.toThrow(/invoice/);
    expect(recordInvoicePayment).not.toHaveBeenCalled();
  });
});

describe("recordAdditionZohoPayment (one-time quote)", () => {
  it("records the payment against the one-time quote's invoice and stores the payment id", async () => {
    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValue(paidCharge as never);

    expect(await recordAdditionZohoPayment(fakeSupabase, "QT-9")).toBe("zpay-1");

    expect(recordInvoicePayment).toHaveBeenCalledWith("zinv-9", {
      mode: "others",
      date: "2026-10-05",
      reference: "pay_1",
      description: "Paid via Razorpay",
    });
    expect(saveAdditionZohoPaymentId).toHaveBeenCalledWith(fakeSupabase, "add-1", "zpay-1");
  });

  it("skips a quote whose payment is already in Zoho, and refuses one without an invoice", async () => {
    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValueOnce({ ...paidCharge, zoho_payment_id: "zpay-0" } as never);
    expect(await recordAdditionZohoPayment(fakeSupabase, "QT-9")).toBe("zpay-0");
    expect(recordInvoicePayment).not.toHaveBeenCalled();

    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValueOnce({ ...paidCharge, invoice_step_status: "pending", zoho_invoice_id: null } as never);
    await expect(recordAdditionZohoPayment(fakeSupabase, "QT-9")).rejects.toThrow(/invoice/);
  });
});
