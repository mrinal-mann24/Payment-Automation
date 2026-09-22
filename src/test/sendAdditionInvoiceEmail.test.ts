import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({ fetchDealWithLineItemsAndContact: vi.fn() }));
vi.mock("../clients/zoho.js", () => ({ emailInvoice: vi.fn() }));
vi.mock("../repositories/additionCharges.js", () => ({
  findAdditionChargeByEstimateNumber: vi.fn(),
  markAdditionInvoiceEmailSent: vi.fn(),
  markAdditionEmailError: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { emailInvoice } from "../clients/zoho.js";
import {
  findAdditionChargeByEstimateNumber,
  markAdditionEmailError,
  markAdditionInvoiceEmailSent,
} from "../repositories/additionCharges.js";
import { sendAdditionInvoiceEmail } from "../steps/sendAdditionInvoiceEmail.js";

const fakeSupabase = {} as SupabaseClient;

const charge = {
  id: "row-1",
  hubspot_deal_id: "deal-1",
  amount: 2500,
  description: "Site visit",
  narration: "Visit to the Pune office on 12 October",
  zoho_estimate_id: "zest-ot",
  zoho_estimate_number: "QT-OT",
  zoho_estimate_total: 2700,
  razorpay_payment_link_id: "plink-ot",
  razorpay_short_url: "https://rzp.io/i/ot",
  status: "done" as const,
  zoho_invoice_id: "zinv-ot",
  zoho_invoice_number: "INV-OT",
  invoice_step_status: "done" as const,
  periskope_payment_confirmed_sent: true,
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
    billingEmails: ["client@example.com"],
    contactName: "Client Name",
    contactPhone: null,
    lineItems: [],
  });
});

describe("sendAdditionInvoiceEmail", () => {
  it("emails the invoice through Zoho to the HubSpot contact and records it", async () => {
    const result = await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT");

    expect(emailInvoice).toHaveBeenCalledWith("zinv-ot", {
      to: ["client@example.com"],
      subject: "Payment received — invoice INV-OT",
      body: expect.stringContaining("Site visit"),
    });
    expect(markAdditionInvoiceEmailSent).toHaveBeenCalledWith(fakeSupabase, "row-1");
    expect(result).toEqual({ sent: true, error: null });
  });

  it("is idempotent and needs the invoice first", async () => {
    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValueOnce({ ...charge, invoice_email_sent: true });
    expect(await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT")).toEqual({ sent: true, error: null });

    vi.mocked(findAdditionChargeByEstimateNumber).mockResolvedValueOnce({ ...charge, invoice_step_status: "pending", zoho_invoice_id: null });
    expect(await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT")).toMatchObject({ sent: false });

    expect(emailInvoice).not.toHaveBeenCalled();
  });

  it("records a failure and returns it instead of throwing", async () => {
    vi.mocked(emailInvoice).mockRejectedValue(new Error("Zoho Books API error 500"));

    const result = await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT");

    expect(markAdditionEmailError).toHaveBeenCalledWith(fakeSupabase, "row-1", "invoice email: Zoho Books API error 500");
    expect(result).toEqual({ sent: false, error: "Zoho Books API error 500" });
  });
});

describe("sendAdditionInvoiceEmail — billing email", () => {
  it("sends to the deal's billing email when HubSpot provides one", async () => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({
      dealId: "deal-1",
      dealName: "Acme <> VA",
      billingPeriod: null,
      contactEmail: "owner@acme.example",
      billingEmails: ["accounts@acme.example", "cfo@acme.example"],
      contactName: "Client Name",
      contactPhone: null,
      lineItems: [],
    });

    await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT");

    expect(vi.mocked(emailInvoice).mock.calls[0]![1].to).toEqual(["accounts@acme.example", "cfo@acme.example"]);
  });
});

describe("sendAdditionInvoiceEmail — no accountant email", () => {
  it("sends nothing and records why when the deal has no Accountant Email", async () => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({
      dealId: "deal-1",
      dealName: "Acme <> VA",
      billingPeriod: null,
      contactEmail: "owner@acme.example",
      billingEmails: [],
      contactName: "Client Name",
      contactPhone: null,
      lineItems: [],
    });

    const result = await sendAdditionInvoiceEmail(fakeSupabase, "QT-OT");

    expect(emailInvoice).not.toHaveBeenCalled();
    expect(markAdditionEmailError).toHaveBeenCalledWith(fakeSupabase, "row-1", "invoice email: no Accountant Email on the HubSpot deal");
    expect(result).toEqual({ sent: false, error: "no Accountant Email on the HubSpot deal" });
  });
});
