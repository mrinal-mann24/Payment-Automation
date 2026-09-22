import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({ fetchDealWithLineItemsAndContact: vi.fn() }));
vi.mock("../clients/zoho.js", () => ({ getInvoicePdf: vi.fn() }));
vi.mock("../clients/periskope.js", () => ({ sendDocumentMessage: vi.fn(), isValidWhatsappRecipient: vi.fn() }));
vi.mock("../repositories/clients.js", () => ({ findWhatsappGroupId: vi.fn() }));
vi.mock("../repositories/additionCharges.js", () => ({
  findAdditionChargeByEstimateNumber: vi.fn(),
  markAdditionPaymentConfirmedSent: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getInvoicePdf } from "../clients/zoho.js";
import { isValidWhatsappRecipient, sendDocumentMessage } from "../clients/periskope.js";
import { findWhatsappGroupId } from "../repositories/clients.js";
import { findAdditionChargeByEstimateNumber, markAdditionPaymentConfirmedSent } from "../repositories/additionCharges.js";
import { sendAdditionPaymentConfirmation } from "../steps/sendAdditionPaymentConfirmation.js";

const fakeSupabase = {} as SupabaseClient;

const charge = {
  id: "row-1",
  hubspot_deal_id: "deal-1",
  amount: 2500,
  description: "Site visit",
  narration: null,
  zoho_estimate_id: "zest-ot",
  zoho_estimate_number: "QT-OT",
  zoho_estimate_total: 2700,
  razorpay_payment_link_id: "plink-ot",
  razorpay_short_url: "https://rzp.io/i/ot",
  status: "done" as const,
  zoho_invoice_id: "zinv-ot",
  zoho_invoice_number: "INV-OT",
  invoice_step_status: "done" as const,
  periskope_payment_confirmed_sent: false,
  periskope_sent: true,
  periskope_skip_reason: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-05T05:30:00Z",
  updated_at: "2026-10-05T05:30:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValue(charge);
  vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({
    dealId: "deal-1",
    dealName: "Acme <> VA",
    billingPeriod: null,
    contactEmail: "client@example.com",
    contactName: "Client Name",
    contactPhone: "9876543210",
    lineItems: [],
  });
  vi.mocked(getInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(isValidWhatsappRecipient).mockReturnValue(true);
});

describe("sendAdditionPaymentConfirmation", () => {
  it("sends the invoice PDF to the client's WhatsApp group, not the contact's phone", async () => {
    vi.mocked(findWhatsappGroupId).mockResolvedValue("120363423447165818");

    const result = await sendAdditionPaymentConfirmation(fakeSupabase, "QT-OT");

    expect(sendDocumentMessage).toHaveBeenCalledWith(
      "120363423447165818",
      'Payment received, thank you! Your invoice (INV-OT) for "Site visit" has been generated.',
      expect.objectContaining({ filename: "INV-OT.pdf" }),
    );
    expect(markAdditionPaymentConfirmedSent).toHaveBeenCalledWith(fakeSupabase, "row-1");
    expect(result).toEqual({ sent: true, skipReason: null });
  });

  it("falls back to the contact phone without a group", async () => {
    vi.mocked(findWhatsappGroupId).mockResolvedValue(null);

    await sendAdditionPaymentConfirmation(fakeSupabase, "QT-OT");

    expect(sendDocumentMessage).toHaveBeenCalledWith("9876543210", expect.any(String), expect.anything());
  });

  it("is idempotent once the confirmation has been sent", async () => {
    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValue({ ...charge, periskope_payment_confirmed_sent: true });

    const result = await sendAdditionPaymentConfirmation(fakeSupabase, "QT-OT");

    expect(sendDocumentMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: true, skipReason: null });
  });
});
