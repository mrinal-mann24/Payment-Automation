import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  fetchDealWithLineItemsAndContact: vi.fn(),
  addLineItemToDeal: vi.fn(),
}));
vi.mock("../clients/zoho.js", () => ({
  findOrCreateCustomer: vi.fn(),
  createEstimate: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  createRenewalJob: vi.fn(),
  markZohoStepDone: vi.fn(),
  markZohoStepFailed: vi.fn(),
}));
vi.mock("../repositories/clientPricing.js", () => ({
  findClientPricing: vi.fn(),
}));

import { fetchDealWithLineItemsAndContact, addLineItemToDeal } from "../clients/hubspot.js";
import { createEstimate, findOrCreateCustomer } from "../clients/zoho.js";
import {
  createRenewalJob,
  findRenewalJob,
  markZohoStepDone,
  markZohoStepFailed,
} from "../repositories/renewalJobs.js";
import { findClientPricing } from "../repositories/clientPricing.js";
import { createZohoEstimate } from "../steps/createZohoEstimate.js";

const fakeSupabase = {} as SupabaseClient;

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
  vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue(fakeDeal);
  vi.mocked(findClientPricing).mockResolvedValue(null);
});

describe("createZohoEstimate", () => {
  it("skips estimate creation and reuses the stored estimate when the job is already done (REQ-1.4)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({
      id: "job-1",
      hubspot_deal_id: "deal-1",
      billing_period: "2026-07",
      status: "done",
      zoho_estimate_id: "zest-123",
      zoho_estimate_number: "EST-000123",
      zoho_estimate_total: 1000,
      zoho_step_status: "done",
      razorpay_payment_link_id: null,
      razorpay_short_url: null,
      razorpay_step_status: "pending",
      periskope_sent: false,
      periskope_skip_reason: null,
      hubspot_updated: false,
      zoho_invoice_id: null,
      zoho_invoice_number: null,
      invoice_step_status: "pending",
      periskope_payment_confirmed_sent: false,
      hubspot_renewal_done: false,
  reminder_1_sent_at: null,
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
  reminder_skip_reason: null,
      error_log: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    });

    const result = await createZohoEstimate(fakeSupabase, "deal-1");

    expect(result).toEqual({
      zohoEstimateId: "zest-123",
      zohoEstimateNumber: "EST-000123",
      zohoEstimateTotal: 1000,
      billingPeriod: "2026-07",
    });
    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(createEstimate).not.toHaveBeenCalled();
    expect(createRenewalJob).not.toHaveBeenCalled();
  });

  it("records the error on renewal_jobs and halts when the Zoho API call fails (REQ-1.6)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue(null);
    vi.mocked(createRenewalJob).mockResolvedValue({
      id: "job-2",
      hubspot_deal_id: "deal-1",
      billing_period: "2026-07",
      status: "in_progress",
      zoho_estimate_id: null,
      zoho_estimate_number: null,
      zoho_estimate_total: null,
      zoho_step_status: "pending",
      razorpay_payment_link_id: null,
      razorpay_short_url: null,
      razorpay_step_status: "pending",
      periskope_sent: false,
      periskope_skip_reason: null,
      hubspot_updated: false,
      zoho_invoice_id: null,
      zoho_invoice_number: null,
      invoice_step_status: "pending",
      periskope_payment_confirmed_sent: false,
      hubspot_renewal_done: false,
  reminder_1_sent_at: null,
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
  reminder_skip_reason: null,
      error_log: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    });
    vi.mocked(findOrCreateCustomer).mockResolvedValue("zcust-1");
    vi.mocked(createEstimate).mockRejectedValue(new Error("Zoho Books API error 500: boom"));

    await expect(createZohoEstimate(fakeSupabase, "deal-1")).rejects.toThrow(
      "Zoho Books API error 500: boom",
    );

    expect(markZohoStepFailed).toHaveBeenCalledWith(
      fakeSupabase,
      "job-2",
      "Zoho Books API error 500: boom",
    );
    expect(markZohoStepDone).not.toHaveBeenCalled();
  });
});
