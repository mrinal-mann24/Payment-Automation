import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  markDealRenewalDone: vi.fn(),
  fetchDealWithLineItemsAndContact: vi.fn(),
  addLineItemToDeal: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markHubspotRenewalDone: vi.fn(),
}));

import {
  markDealRenewalDone,
  fetchDealWithLineItemsAndContact,
  addLineItemToDeal,
} from "../clients/hubspot.js";
import { findRenewalJob, markHubspotRenewalDone } from "../repositories/renewalJobs.js";
import { markRenewalDone } from "../steps/markRenewalDone.js";

const fakeSupabase = {} as SupabaseClient;

const fakeDeal = {
  dealId: "deal-1",
  dealName: "Renewal",
  billingPeriod: "2026-07",
  contactEmail: "client@example.com",
  contactName: "Client Name",
  contactPhone: "919876543210",
  lineItems: [{ id: "li-1", name: "Bookkeeping + GST + TDS Services VA", quantity: 1, price: 39000 }],
};

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-07",
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
  zoho_invoice_id: "zinv-123",
  zoho_invoice_number: "INV-000123",
  invoice_step_status: "done" as const,
  periskope_payment_confirmed_sent: true,
  hubspot_renewal_done: false,
  reminder_1_sent_at: null,
  reminder_2_sent_at: null,
  reminder_3_sent_at: null,
  reminder_skip_reason: null,
  error_log: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal });
});

describe("markRenewalDone", () => {
  it("refuses to run when invoice_step_status is not done", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, invoice_step_status: "pending" });

    await expect(markRenewalDone(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /invoice_step_status is not "done"/,
    );
    expect(markDealRenewalDone).not.toHaveBeenCalled();
  });

  it("moves the deal to Renewal Done and marks the job (REQ-4.10)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-07");

    expect(markDealRenewalDone).toHaveBeenCalledWith("deal-1");
    expect(markHubspotRenewalDone).toHaveBeenCalledWith(fakeSupabase, "job-1");
  });

  it("adds a copy of the deal's line item once payment is confirmed", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-07");

    expect(addLineItemToDeal).toHaveBeenCalledWith("deal-1", {
      name: "Bookkeeping + GST + TDS Services VA",
      quantity: 1,
      price: 39000,
    });
  });

  it("does not add a line item when the deal has none", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal, lineItems: [] });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-07");

    expect(addLineItemToDeal).not.toHaveBeenCalled();
  });

  it("is idempotent: does not re-run when hubspot_renewal_done is already true", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, hubspot_renewal_done: true });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-07");

    expect(markDealRenewalDone).not.toHaveBeenCalled();
    expect(markHubspotRenewalDone).not.toHaveBeenCalled();
    expect(addLineItemToDeal).not.toHaveBeenCalled();
  });

  it("throws when no renewal_job exists for the deal", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue(null);

    await expect(markRenewalDone(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /invoice_step_status is not "done"/,
    );
  });
});
