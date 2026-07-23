import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysOverdue, nextDueStage, parseDueDate } from "./reminderCron.js";

const baseJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "Monthly-2026-07-10",
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

describe("parseDueDate", () => {
  it("parses the trailing YYYY-MM-DD out of billing_period regardless of billing_cycle value", () => {
    expect(parseDueDate("Monthly-2026-07-10")?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(parseDueDate("Quarterly-2026-08-15")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(parseDueDate("Annual-2027-01-01")?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("returns null for an unparseable billing_period", () => {
    expect(parseDueDate("garbage")).toBeNull();
    expect(parseDueDate("")).toBeNull();
  });
});

describe("daysOverdue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes whole days between the due date and today (UTC)", () => {
    vi.setSystemTime(new Date("2026-07-12T09:00:00Z"));
    expect(daysOverdue(new Date("2026-07-10T00:00:00Z"))).toBe(2);
  });

  it("returns 0 the day of, and negative before the due date", () => {
    vi.setSystemTime(new Date("2026-07-10T23:00:00Z"));
    expect(daysOverdue(new Date("2026-07-10T00:00:00Z"))).toBe(0);
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));
    expect(daysOverdue(new Date("2026-07-10T00:00:00Z"))).toBe(-1);
  });
});

describe("nextDueStage", () => {
  it("returns stage 1 at exactly 2 days overdue if not yet sent (REQ-5.2)", () => {
    expect(nextDueStage(baseJob, 2)).toBe(1);
  });

  it("returns stage 2 at exactly 4 days overdue if not yet sent (REQ-5.3)", () => {
    expect(nextDueStage(baseJob, 4)).toBe(2);
  });

  it("returns stage 3 at exactly 7 days overdue if not yet sent (REQ-5.4)", () => {
    expect(nextDueStage(baseJob, 7)).toBe(3);
  });

  it("returns null on a day that doesn't match any reminder stage", () => {
    expect(nextDueStage(baseJob, 3)).toBeNull();
    expect(nextDueStage(baseJob, 10)).toBeNull();
  });

  it("does not resend a stage that's already been sent (REQ-5.6)", () => {
    expect(nextDueStage({ ...baseJob, reminder_1_sent_at: "2026-07-12T06:00:00Z" }, 2)).toBeNull();
  });
});
