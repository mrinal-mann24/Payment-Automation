import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../steps/createZohoEstimate.js", () => ({ createZohoEstimate: vi.fn() }));
vi.mock("../steps/createRazorpayLink.js", () => ({ createRazorpayLink: vi.fn() }));
vi.mock("../steps/sendRenewalMessage.js", () => ({ sendRenewalMessage: vi.fn() }));
vi.mock("../steps/sendQuoteEmail.js", () => ({ sendQuoteEmail: vi.fn() }));
vi.mock("../steps/updateHubspotDeal.js", () => ({ updateHubspotDeal: vi.fn() }));

import { createZohoEstimate } from "../steps/createZohoEstimate.js";
import { createRazorpayLink } from "../steps/createRazorpayLink.js";
import { sendRenewalMessage } from "../steps/sendRenewalMessage.js";
import { sendQuoteEmail } from "../steps/sendQuoteEmail.js";
import { updateHubspotDeal } from "../steps/updateHubspotDeal.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";

const fakeSupabase = {} as SupabaseClient;

const octoberCycle = {
  key: "2026-10",
  period: { start: "2026-10-01", end: "2026-10-31", narration: "Service period: 1 October 2026 to 31 October 2026" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createZohoEstimate).mockResolvedValue({
    zohoEstimateId: "zest-1",
    zohoEstimateNumber: "QT-1",
    zohoEstimateTotal: 5400,
    billingPeriod: "2026-10",
  });
  vi.mocked(createRazorpayLink).mockResolvedValue({ paymentLinkId: "plink-1", shortUrl: "https://rzp.io/i/1" });
  vi.mocked(sendRenewalMessage).mockResolvedValue({ sent: true, skipReason: null });
  vi.mocked(sendQuoteEmail).mockResolvedValue({ sent: true, error: null });
  vi.mocked(updateHubspotDeal).mockResolvedValue(undefined);
});

describe("runRenewalPipeline", () => {
  it("runs estimate -> link -> WhatsApp -> email -> job flag for a monthly cycle and returns the combined result", async () => {
    const result = await runRenewalPipeline(fakeSupabase, "deal-1", octoberCycle);

    expect(createZohoEstimate).toHaveBeenCalledWith(fakeSupabase, "deal-1", octoberCycle);
    expect(createRazorpayLink).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(sendRenewalMessage).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(sendQuoteEmail).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(updateHubspotDeal).toHaveBeenCalledWith(fakeSupabase, "deal-1", "2026-10");
    expect(result).toEqual({
      billingPeriod: "2026-10",
      zohoEstimateId: "zest-1",
      zohoEstimateNumber: "QT-1",
      paymentLinkId: "plink-1",
      shortUrl: "https://rzp.io/i/1",
      periskopeSent: true,
      periskopeSkipReason: null,
      emailSent: true,
      emailError: null,
    });
  });

  it("still emails and flags the job when the WhatsApp send throws", async () => {
    vi.mocked(sendRenewalMessage).mockRejectedValue(new Error("Periskope API error 500: down"));

    const result = await runRenewalPipeline(fakeSupabase, "deal-1", octoberCycle);

    expect(result.periskopeSent).toBe(false);
    expect(result.periskopeSkipReason).toMatch(/Periskope API error 500/);
    expect(sendQuoteEmail).toHaveBeenCalled();
    expect(updateHubspotDeal).toHaveBeenCalled();
  });

  it("passes no cycle on the legacy path", async () => {
    vi.mocked(createZohoEstimate).mockResolvedValue({
      zohoEstimateId: "zest-1",
      zohoEstimateNumber: "QT-1",
      zohoEstimateTotal: 5400,
      billingPeriod: "Monthly-2026-10-15",
    });

    const result = await runRenewalPipeline(fakeSupabase, "deal-1");

    expect(vi.mocked(createZohoEstimate).mock.calls[0]![2]).toBeUndefined();
    expect(createRazorpayLink).toHaveBeenCalledWith(fakeSupabase, "deal-1", "Monthly-2026-10-15");
    expect(result.billingPeriod).toBe("Monthly-2026-10-15");
  });
});
