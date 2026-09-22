import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/supabase.js", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("../repositories/renewalJobs.js", () => ({ findUnpaidCycleJobs: vi.fn() }));
vi.mock("../clients/razorpay.js", () => ({ fetchPaymentLink: vi.fn() }));
vi.mock("../steps/sendOverdueReminder.js", () => ({ sendOverdueReminder: vi.fn() }));
vi.mock("../steps/settleRenewalPayment.js", () => ({ settleRenewalPayment: vi.fn() }));

import { findUnpaidCycleJobs } from "../repositories/renewalJobs.js";
import { fetchPaymentLink } from "../clients/razorpay.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { reminderStageForDay, reminderStageForJob, runOverdueReminderCheck } from "../jobs/reminderCron.js";

const unpaidJob = {
  id: "job-1",
  hubspot_deal_id: "deal-1",
  billing_period: "2026-10",
  status: "done",
  zoho_estimate_id: "zest-1",
  zoho_estimate_number: "QT-1",
  zoho_estimate_total: 5400,
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
  service_period_start: "2026-10-01",
  term_months: 1,
  billed_price: 5000,
  paid_at: null,
  payment_method: null,
  payment_amount: null,
  payment_date: null,
  payment_narration: null,
  payment_reference: null,
  hubspot_line_item_id: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-01T05:30:00Z",
  updated_at: "2026-10-01T05:30:00Z",
};

// A quarterly cycle quoted on 9 October: reminders on the 13th, 15th, 17th.
const quarterlyJob = {
  ...unpaidJob,
  id: "job-q",
  hubspot_deal_id: "deal-q",
  billing_period: "2026-10-09",
  service_period_start: "2026-10-09",
  term_months: 3,
  billed_price: 39000,
  razorpay_payment_link_id: "plink-q",
};

// 11:00 IST on the given October day.
const istTick = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T05:30:00Z`);

const sent = () => vi.mocked(sendOverdueReminder).mock.calls.map((c) => [c[1], c[3]]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findUnpaidCycleJobs).mockResolvedValue([unpaidJob, quarterlyJob]);
  vi.mocked(fetchPaymentLink).mockResolvedValue({ id: "plink-1", status: "created", short_url: "https://rzp.io/i/1" });
  vi.mocked(sendOverdueReminder).mockResolvedValue({ sent: true, skipReason: null });
});

describe("reminderStageForDay", () => {
  it("maps day 5/6, 7/8 and 9/10 of a cycle to stages 1, 2 and 3 and nothing else", () => {
    expect([1, 4, 5, 6, 7, 8, 9, 10, 11, 31].map(reminderStageForDay)).toEqual([
      null, null, 1, 1, 2, 2, 3, 3, null, null,
    ]);
  });
});

describe("reminderStageForJob", () => {
  it("counts days from the cycle's own start: the 5th/7th/9th for a monthly cycle, +4/+6/+8 days for a term", () => {
    expect([1, 4, 5, 6, 7, 8, 9, 10, 11].map((d) => reminderStageForJob(unpaidJob, `2026-10-${String(d).padStart(2, "0")}`))).toEqual([
      null, null, 1, 1, 2, 2, 3, 3, null,
    ]);
    expect([9, 12, 13, 14, 15, 16, 17, 18, 19].map((d) => reminderStageForJob(quarterlyJob, `2026-10-${d}`))).toEqual([
      null, null, 1, 1, 2, 2, 3, 3, null,
    ]);
  });

  it("never reminds a legacy row (no service period)", () => {
    expect(reminderStageForJob({ ...unpaidJob, service_period_start: null, term_months: null }, "2026-10-05")).toBeNull();
  });
});

describe("runOverdueReminderCheck", () => {
  it("on the 5th sends reminder 1 for the monthly cycle only — the quarterly one is not due yet (TEST 4)", async () => {
    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-1", 1]]);
  });

  it("on the 7th and 9th sends stages 2 and 3 for the monthly cycle (TEST 4)", async () => {
    await runOverdueReminderCheck(istTick(7), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(9), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-1", 2], ["deal-1", 3]]);
  });

  it("reminds the quarterly cycle 4, 6 and 8 days after its quote while the monthly one is silent", async () => {
    await runOverdueReminderCheck(istTick(13), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(15), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(17), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-q", 1], ["deal-q", 2], ["deal-q", 3]]);
  });

  it("sends nothing on days outside every cycle's schedule", async () => {
    await runOverdueReminderCheck(istTick(4), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(11), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(12), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(19), { pauseMs: 0 });

    expect(sendOverdueReminder).not.toHaveBeenCalled();
    expect(fetchPaymentLink).not.toHaveBeenCalled();
  });

  it("recovers a missed tick on the 6th but never re-sends a stage that already went out (TEST 9)", async () => {
    vi.mocked(findUnpaidCycleJobs).mockResolvedValue([
      unpaidJob,
      { ...unpaidJob, id: "job-2", hubspot_deal_id: "deal-2", reminder_1_sent_at: "2026-10-05T05:31:00Z" },
    ]);

    await runOverdueReminderCheck(istTick(6), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-1", 1]]);
  });

  it("settles instead of reminding when Razorpay shows the link as paid (lost-webhook guard)", async () => {
    vi.mocked(fetchPaymentLink).mockResolvedValue({ id: "plink-1", status: "paid", short_url: "https://rzp.io/i/1" });

    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 });

    expect(settleRenewalPayment).toHaveBeenCalledWith(
      expect.anything(),
      unpaidJob,
      expect.objectContaining({ method: "razorpay" }),
    );
    expect(sendOverdueReminder).not.toHaveBeenCalled();
  });

  it("keeps going when one job fails", async () => {
    vi.mocked(findUnpaidCycleJobs).mockResolvedValue([unpaidJob, { ...unpaidJob, id: "job-2", hubspot_deal_id: "deal-2" }]);
    vi.mocked(sendOverdueReminder).mockRejectedValueOnce(new Error("Periskope API error 500"));

    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-1", 1], ["deal-2", 1]]);
  });
});
