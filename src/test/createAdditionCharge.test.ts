import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({ fetchDealWithLineItemsAndContact: vi.fn() }));
vi.mock("../clients/zoho.js", () => ({
  findOrCreateCustomer: vi.fn(),
  createEstimate: vi.fn(),
  getEstimatePdf: vi.fn(),
  emailEstimate: vi.fn(),
}));
vi.mock("../clients/razorpay.js", () => ({ createPaymentLink: vi.fn() }));
vi.mock("../clients/periskope.js", () => ({ sendDocumentMessage: vi.fn(), isValidWhatsappRecipient: vi.fn() }));
vi.mock("../repositories/clients.js", () => ({ findWhatsappGroupId: vi.fn() }));
vi.mock("../repositories/additionCharges.js", () => ({
  createAdditionChargeRow: vi.fn(),
  findRecentDuplicateAdditionCharge: vi.fn(),
  markAdditionChargeDone: vi.fn(),
  markAdditionChargeFailed: vi.fn(),
  markAdditionPeriskopeSent: vi.fn(),
  markAdditionPeriskopeSkipped: vi.fn(),
  markAdditionEstimateEmailSent: vi.fn(),
  markAdditionEmailError: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { createEstimate, emailEstimate, findOrCreateCustomer, getEstimatePdf } from "../clients/zoho.js";
import { createPaymentLink } from "../clients/razorpay.js";
import { isValidWhatsappRecipient, sendDocumentMessage } from "../clients/periskope.js";
import { findWhatsappGroupId } from "../repositories/clients.js";
import {
  createAdditionChargeRow,
  findRecentDuplicateAdditionCharge,
  markAdditionChargeDone,
  markAdditionChargeFailed,
  markAdditionEmailError,
  markAdditionEstimateEmailSent,
  markAdditionPeriskopeSent,
  markAdditionPeriskopeSkipped,
} from "../repositories/additionCharges.js";
import { createAdditionCharge } from "../steps/createAdditionCharge.js";

const fakeSupabase = {} as SupabaseClient;

const deal = {
  dealId: "deal-1",
  dealName: "Acme <> VA",
  billingPeriod: null,
  contactEmail: "client@example.com",
  billingEmails: ["client@example.com"],
  contactName: "Client Name",
  contactPhone: "9876543210",
  lineItems: [{ id: "li-1", name: "VA Monthly", quantity: 1, price: 5000 }],
};

const row = {
  id: "0d2b6c1e-1111-2222-3333-444455556666",
  hubspot_deal_id: "deal-1",
  amount: 2500,
  description: "Site visit",
  narration: "Visit to the Pune office on 12 October",
  zoho_estimate_id: null,
  zoho_estimate_number: null,
  zoho_estimate_total: null,
  razorpay_payment_link_id: null,
  razorpay_short_url: null,
  status: "pending" as const,
  zoho_invoice_id: null,
  zoho_invoice_number: null,
  invoice_step_status: "pending" as const,
  periskope_payment_confirmed_sent: false,
  periskope_sent: false,
  periskope_skip_reason: null,
  estimate_email_sent: false,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-05T05:30:00Z",
  updated_at: "2026-10-05T05:30:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue(deal);
  vi.mocked(findRecentDuplicateAdditionCharge).mockResolvedValue(null);
  vi.mocked(createAdditionChargeRow).mockResolvedValue(row);
  vi.mocked(findOrCreateCustomer).mockResolvedValue("zcust-1");
  vi.mocked(createEstimate).mockResolvedValue({ estimateId: "zest-ot", estimateNumber: "QT-OT", total: 2700 });
  vi.mocked(createPaymentLink).mockResolvedValue({ paymentLinkId: "plink-ot", shortUrl: "https://rzp.io/i/ot" });
  vi.mocked(getEstimatePdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(findWhatsappGroupId).mockResolvedValue("120363423447165818");
  vi.mocked(isValidWhatsappRecipient).mockReturnValue(true);
});

describe("createAdditionCharge (one-time quote)", () => {
  it("quotes the service with its narration, sends the PDF to the client's WhatsApp group and emails it with the link", async () => {
    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", "Visit to the Pune office on 12 October");

    expect(createAdditionChargeRow).toHaveBeenCalledWith(fakeSupabase, "deal-1", 2500, "Site visit", "Visit to the Pune office on 12 October");
    expect(createEstimate).toHaveBeenCalledWith(
      "zcust-1",
      expect.objectContaining({ lineItems: [expect.objectContaining({ name: "Site visit", price: 2500, quantity: 1 })] }),
      { key: "one-time-0d2b6c1e", name: "Site visit", description: "Visit to the Pune office on 12 October" },
    );
    expect(createPaymentLink).toHaveBeenCalledWith("QT-OT", 270000, expect.stringContaining("Site visit"));
    expect(markAdditionChargeDone).toHaveBeenCalledWith(fakeSupabase, row.id, expect.objectContaining({ zohoEstimateNumber: "QT-OT" }));

    expect(sendDocumentMessage).toHaveBeenCalledWith(
      "120363423447165818",
      "Your quote (QT-OT) for Site visit is ready. Pay here: https://rzp.io/i/ot",
      expect.objectContaining({ filename: "QT-OT.pdf", mimetype: "application/pdf" }),
    );
    expect(markAdditionPeriskopeSent).toHaveBeenCalledWith(fakeSupabase, row.id);

    expect(emailEstimate).toHaveBeenCalledWith("zest-ot", {
      to: ["client@example.com"],
      subject: "Quote QT-OT — Site visit",
      body: expect.stringContaining("https://rzp.io/i/ot"),
    });
    expect(vi.mocked(emailEstimate).mock.calls[0]![1].body).toContain("Visit to the Pune office on 12 October");
    expect(markAdditionEstimateEmailSent).toHaveBeenCalledWith(fakeSupabase, row.id);

    expect(result).toEqual({
      zohoEstimateNumber: "QT-OT",
      zohoEstimateTotal: 2700,
      razorpayShortUrl: "https://rzp.io/i/ot",
      periskopeSent: true,
      periskopeSkipReason: null,
      emailSent: true,
      emailError: null,
    });
  });

  it("falls back to the contact's phone when the deal has no WhatsApp group", async () => {
    vi.mocked(findWhatsappGroupId).mockResolvedValue(null);

    await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(sendDocumentMessage).toHaveBeenCalledWith("9876543210", expect.any(String), expect.anything());
  });

  it("records a skipped WhatsApp send (no recipient) and still emails the quote", async () => {
    vi.mocked(findWhatsappGroupId).mockResolvedValue(null);
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...deal, contactPhone: null });

    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(sendDocumentMessage).not.toHaveBeenCalled();
    expect(markAdditionPeriskopeSkipped).toHaveBeenCalledWith(fakeSupabase, row.id, expect.stringMatching(/No WhatsApp identifier/));
    expect(emailEstimate).toHaveBeenCalled();
    expect(result).toMatchObject({ periskopeSent: false, emailSent: true });
  });

  it("keeps the quote when WhatsApp throws — the send is recorded as skipped and the email still goes out", async () => {
    vi.mocked(sendDocumentMessage).mockRejectedValueOnce(new Error("Periskope API error 500"));

    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(markAdditionChargeFailed).not.toHaveBeenCalled();
    expect(markAdditionPeriskopeSkipped).toHaveBeenCalledWith(fakeSupabase, row.id, "Periskope API error 500");
    expect(emailEstimate).toHaveBeenCalled();
    expect(result).toMatchObject({ periskopeSent: false, periskopeSkipReason: "Periskope API error 500", emailSent: true });
  });

  it("records an email failure on the row and returns it rather than throwing", async () => {
    vi.mocked(emailEstimate).mockRejectedValueOnce(new Error("Zoho Books API error 401: scope"));

    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(markAdditionEmailError).toHaveBeenCalledWith(fakeSupabase, row.id, "quote email: Zoho Books API error 401: scope");
    expect(result).toMatchObject({ periskopeSent: true, emailSent: false, emailError: "Zoho Books API error 401: scope" });
  });

  it("leaves the narration out of the quote when none was given", async () => {
    await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(vi.mocked(createEstimate).mock.calls[0]![2]).toEqual({ key: "one-time-0d2b6c1e", name: "Site visit", description: null });
  });

  it("returns the recent identical quote instead of sending it twice", async () => {
    vi.mocked(findRecentDuplicateAdditionCharge).mockResolvedValue({
      ...row,
      status: "done",
      zoho_estimate_number: "QT-OLD",
      zoho_estimate_total: 2700,
      razorpay_short_url: "https://rzp.io/i/old",
      periskope_sent: true,
      estimate_email_sent: true,
    });

    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(createEstimate).not.toHaveBeenCalled();
    expect(sendDocumentMessage).not.toHaveBeenCalled();
    expect(emailEstimate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ zohoEstimateNumber: "QT-OLD", periskopeSent: true, emailSent: true });
  });
});

describe("createAdditionCharge — billing email", () => {
  it("emails the one-time quote to the billing email, while the Zoho customer stays keyed by the contact identity", async () => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...deal, billingEmails: ["accounts@acme.example", "cfo@acme.example"] });

    await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(findOrCreateCustomer).toHaveBeenCalledWith("client@example.com", "Client Name");
    expect(vi.mocked(emailEstimate).mock.calls[0]![1].to).toEqual(["accounts@acme.example", "cfo@acme.example"]);
  });
});

describe("createAdditionCharge — no accountant email", () => {
  it("still sends the quote on WhatsApp but skips the email with a recorded reason", async () => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...deal, billingEmails: [] });

    const result = await createAdditionCharge(fakeSupabase, "deal-1", 2500, "Site visit", null);

    expect(sendDocumentMessage).toHaveBeenCalled();
    expect(emailEstimate).not.toHaveBeenCalled();
    expect(markAdditionEmailError).toHaveBeenCalledWith(fakeSupabase, row.id, "quote email: no Accountant Email on the HubSpot deal");
    expect(result).toMatchObject({ periskopeSent: true, emailSent: false, emailError: "no Accountant Email on the HubSpot deal" });
  });
});
