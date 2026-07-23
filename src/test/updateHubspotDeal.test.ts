import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../repositories/renewalJobs.js", () => ({
  findRenewalJob: vi.fn(),
  markHubspotUpdated: vi.fn(),
}));

import { findRenewalJob, markHubspotUpdated } from "../repositories/renewalJobs.js";
import { updateHubspotDeal } from "./updateHubspotDeal.js";

const fakeSupabase = {} as SupabaseClient;

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-07",
  status: "in_progress" as const,
  zoho_estimate_id: "zest-123",
  zoho_estimate_number: "EST-000123",
  zoho_estimate_total: 1000,
  zoho_step_status: "done" as const,
  razorpay_payment_link_id: "plink-1",
  razorpay_short_url: "https://rzp.io/i/1",
  razorpay_step_status: "done" as const,
  periskope_sent: false,
  periskope_skip_reason: "No WhatsApp identifier (contact phone) found for deal deal-1",
  hubspot_updated: false,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateHubspotDeal", () => {
  it("marks the job done even when Periskope was skipped (REQ-3.4 does not block REQ-3.6)", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob });

    await updateHubspotDeal(fakeSupabase, "deal-1", "2026-07");

    expect(markHubspotUpdated).toHaveBeenCalledWith(fakeSupabase, "job-1");
  });

  it("is idempotent: does not re-run when hubspot_updated is already true", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue({ ...baseJob, hubspot_updated: true });

    await updateHubspotDeal(fakeSupabase, "deal-1", "2026-07");

    expect(markHubspotUpdated).not.toHaveBeenCalled();
  });

  it("throws when no renewal_job exists for the deal", async () => {
    vi.mocked(findRenewalJob).mockResolvedValue(null);

    await expect(updateHubspotDeal(fakeSupabase, "deal-1", "2026-07")).rejects.toThrow(
      /no renewal_job found/,
    );
  });
});
