import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../clients/hubspot.js", () => ({
  markDealRenewalDone: vi.fn(),
  fetchDealWithLineItemsAndContact: vi.fn(),
  addLineItemToDeal: vi.fn(),
  createRenewalLineItem: vi.fn(),
  updateDealNextRenewalDate: vi.fn(),
}));
vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markHubspotRenewalDone: vi.fn(),
  saveHubspotLineItemId: vi.fn(),
}));

import {
  markDealRenewalDone,
  fetchDealWithLineItemsAndContact,
  addLineItemToDeal,
  createRenewalLineItem,
  updateDealNextRenewalDate,
} from "../clients/hubspot.js";
import { findRenewalJob, markHubspotRenewalDone, saveHubspotLineItemId } from "../repositories/renewalJobs.js";
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
  service_period_start: null,
  term_months: null,
  billed_price: null,
  paid_at: null,
  payment_method: null,
  payment_amount: null,
  payment_date: null,
  payment_narration: null,
  payment_reference: null,
  hubspot_line_item_id: null,
  estimate_email_sent: false,
  invoice_email_sent: false,
  email_error: null,
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

const monthlyJob = {
  ...baseJob,
  billing_period: "2026-10",
  service_period_start: "2026-10-01",
  term_months: 1,
  billed_price: 5000,
  paid_at: "2026-10-03T04:00:00Z",
  payment_method: "yes_bank",
  payment_date: "2026-10-03",
};

const previousItem = {
  id: "li-old",
  name: "Bookkeeping + GST + TDS Services VA",
  quantity: 1,
  price: 39000,
  recurringBillingFrequency: "monthly",
  billingPeriodTerm: "P1M",
  billingStartDate: "2026-09-01",
  billingTermEndDate: "2026-10-01",
  recurringRevenueType: "Renewal",
  productId: "prod-1",
};

describe("markRenewalDone for a monthly cycle", () => {
  beforeEach(() => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({ ...fakeDeal, lineItems: [previousItem] });
    vi.mocked(createRenewalLineItem).mockResolvedValue("li-new");
  });

  it("creates ONE complete Renewal line item at the billed price and stores its id before moving the deal stage", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...monthlyJob });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-10");

    expect(createRenewalLineItem).toHaveBeenCalledWith("deal-1", {
      name: "Bookkeeping + GST + TDS Services VA",
      price: 5000,
      productId: "prod-1",
      billingStartDate: "2026-10-01",
      datePaid: "2026-10-03",
      months: 1,
    });
    expect(saveHubspotLineItemId).toHaveBeenCalledWith(fakeSupabase, "job-1", "li-new");
    // HubSpot's Next Renewal Date moves to the day after the paid month, so the next cycle is found without manual entry.
    expect(updateDealNextRenewalDate).toHaveBeenCalledWith("deal-1", "2026-11-01");
    expect(vi.mocked(updateDealNextRenewalDate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(markDealRenewalDone).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(saveHubspotLineItemId).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(markDealRenewalDone).mock.invocationCallOrder[0]!,
    );
    expect(addLineItemToDeal).not.toHaveBeenCalled();
    expect(markDealRenewalDone).toHaveBeenCalledWith("deal-1");
  });

  it("adopts a line item the team already entered for the same period instead of creating a second one", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...monthlyJob });
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({
      ...fakeDeal,
      lineItems: [previousItem, { ...previousItem, id: "li-hand", billingStartDate: "2026-10-01", billingTermEndDate: "2026-11-01" }],
    });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-10");

    expect(createRenewalLineItem).not.toHaveBeenCalled();
    expect(saveHubspotLineItemId).toHaveBeenCalledWith(fakeSupabase, "job-1", "li-hand");
  });

  it("creates nothing when the line item id is already stored (crash between create and stage move)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...monthlyJob, hubspot_line_item_id: "li-new" });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-10");

    expect(createRenewalLineItem).not.toHaveBeenCalled();
    expect(saveHubspotLineItemId).not.toHaveBeenCalled();
    expect(markDealRenewalDone).toHaveBeenCalledWith("deal-1");
  });

  it("keeps the bare copy for legacy cycles but at the price actually billed", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, billed_price: 34000 });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-07");

    expect(addLineItemToDeal).toHaveBeenCalledWith("deal-1", {
      name: "Bookkeeping + GST + TDS Services VA",
      quantity: 1,
      price: 34000,
    });
    expect(createRenewalLineItem).not.toHaveBeenCalled();
    expect(updateDealNextRenewalDate).not.toHaveBeenCalled();
  });
});

describe("markRenewalDone for a quarterly term cycle", () => {
  it("writes one complete quarterly Renewal line item starting the day the last term ended, priced at what was billed", async () => {
    vi.mocked(fetchDealWithLineItemsAndContact).mockResolvedValue({
      ...fakeDeal,
      lineItems: [
        {
          ...previousItem,
          recurringBillingFrequency: "quarterly",
          billingPeriodTerm: "P3M",
          billingStartDate: "2026-07-09",
          billingTermEndDate: "2026-10-09",
        },
      ],
    });
    vi.mocked(createRenewalLineItem).mockResolvedValue("li-q");
    vi.mocked(findRenewalJob).mockResolvedValue({
      ...monthlyJob,
      billing_period: "2026-10-09",
      service_period_start: "2026-10-09",
      term_months: 3,
      billed_price: 39000,
      payment_date: "2026-10-10",
    });

    await markRenewalDone(fakeSupabase, "deal-1", "2026-10-09");

    expect(createRenewalLineItem).toHaveBeenCalledWith("deal-1", {
      name: "Bookkeeping + GST + TDS Services VA",
      price: 39000,
      productId: "prod-1",
      billingStartDate: "2026-10-09",
      datePaid: "2026-10-10",
      months: 3,
    });
    expect(saveHubspotLineItemId).toHaveBeenCalledWith(fakeSupabase, "job-1", "li-q");
    expect(updateDealNextRenewalDate).toHaveBeenCalledWith("deal-1", "2027-01-09");
    expect(addLineItemToDeal).not.toHaveBeenCalled();
  });
});
