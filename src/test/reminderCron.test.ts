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
import { dueDateForStage, reminderStageForJob, runOverdueReminderCheck } from "../jobs/reminderCron.js";

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
  // 1 October 2026 is a Thursday — days 5/9/12 (5, 9, 12 Oct) are Mon/Fri/Mon,
  // none of them a Sunday, so this is the plain, unshifted baseline.
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
  zoho_payment_id: null,
  estimate_email_sent: true,
  invoice_email_sent: false,
  email_error: null,
  error_log: null,
  created_at: "2026-10-01T05:30:00Z",
  updated_at: "2026-10-01T05:30:00Z",
};

// A quarterly cycle quoted on 9 October (a Friday): reminders on the 13th,
// 17th, 20th — also none of them a Sunday.
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

// A cycle starting 30 September (a Wednesday): day 5 (4 Oct) and day 12
// (11 Oct) are both real Sundays, day 9 (8 Oct, Thursday) is not — one
// fixture that exercises both the shifted and the unshifted case.
const sundayJob = {
  ...unpaidJob,
  id: "job-sun",
  hubspot_deal_id: "deal-sun",
  billing_period: "2026-09-30",
  service_period_start: "2026-09-30",
  razorpay_payment_link_id: "plink-sun",
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

describe("dueDateForStage", () => {
  it("is day 5, 9 or 12 of the cycle, counted from its own start date", () => {
    expect(dueDateForStage("2026-10-01", 1)).toBe("2026-10-05");
    expect(dueDateForStage("2026-10-01", 2)).toBe("2026-10-09");
    expect(dueDateForStage("2026-10-01", 3)).toBe("2026-10-12");
  });

  it("shifts to the following day when the calculated date is a Sunday", () => {
    expect(dueDateForStage("2026-09-30", 1)).toBe("2026-10-05"); // 4 Oct (Sun) -> 5 Oct (Mon)
    expect(dueDateForStage("2026-09-30", 2)).toBe("2026-10-08"); // 8 Oct (Thu) — not a Sunday, unchanged
    expect(dueDateForStage("2026-09-30", 3)).toBe("2026-10-12"); // 11 Oct (Sun) -> 12 Oct (Mon)
  });
});

describe("reminderStageForJob", () => {
  it("is the stage due on this exact date or the one-day grace day after it", () => {
    expect(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d) => reminderStageForJob(unpaidJob, d))).toEqual([
      null,
      1,
      1,
      null,
    ]);
    expect(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map((d) => reminderStageForJob(unpaidJob, d))).toEqual([
      null,
      2,
      2,
      null,
    ]);
    expect(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((d) => reminderStageForJob(unpaidJob, d))).toEqual([
      null,
      3,
      3,
      null,
    ]);
  });

  it("counts from the term's own quote date for a quarterly cycle (13th, 17th, 20th)", () => {
    expect(["2026-10-13", "2026-10-17", "2026-10-20"].map((d) => reminderStageForJob(quarterlyJob, d))).toEqual([1, 2, 3]);
  });

  it("fires on the Sunday-shifted day, not the Sunday itself, and the grace day after that", () => {
    expect(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d) => reminderStageForJob(sundayJob, d))).toEqual([
      null, // the Sunday itself: nothing
      1, // shifted to Monday
      1, // grace day
      null,
    ]);
    expect(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((d) => reminderStageForJob(sundayJob, d))).toEqual([
      null,
      3,
      3,
      null,
    ]);
  });

  it("never reminds a legacy row (no service period)", () => {
    expect(reminderStageForJob({ ...unpaidJob, service_period_start: null, term_months: null }, "2026-10-05")).toBeNull();
  });
});

describe("runOverdueReminderCheck", () => {
  it("on day 5 sends reminder 1 for the monthly cycle only — the quarterly one is not due yet", async () => {
    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 });

    expect(sent()).toEqual([["deal-1", 1]]);
  });

  it("on day 9 and day 12 sends stages 2 and 3 for the monthly cycle", async () => {
    await runOverdueReminderCheck(istTick(9), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(12), { pauseMs: 0 });

    expect(sent()).toEqual([
      ["deal-1", 2],
      ["deal-1", 3],
    ]);
  });

  it("passes the tick's IST date through to sendOverdueReminder", async () => {
    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 });

    expect(vi.mocked(sendOverdueReminder).mock.calls[0]![4]).toBe("2026-10-05");
  });

  it("reminds the quarterly cycle on days 13, 17 and 20 while the monthly one is silent", async () => {
    vi.mocked(findUnpaidCycleJobs).mockResolvedValue([quarterlyJob]);

    await runOverdueReminderCheck(istTick(13), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(17), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(20), { pauseMs: 0 });

    expect(sent()).toEqual([
      ["deal-q", 1],
      ["deal-q", 2],
      ["deal-q", 3],
    ]);
  });

  it("shifts a cycle whose day-5 and day-12 land on a Sunday to the Monday after", async () => {
    vi.mocked(findUnpaidCycleJobs).mockResolvedValue([sundayJob]);

    await runOverdueReminderCheck(istTick(4), { pauseMs: 0 }); // the Sunday itself
    await runOverdueReminderCheck(istTick(5), { pauseMs: 0 }); // shifted day-5
    await runOverdueReminderCheck(istTick(11), { pauseMs: 0 }); // the Sunday itself
    await runOverdueReminderCheck(istTick(12), { pauseMs: 0 }); // shifted day-12

    expect(sent()).toEqual([
      ["deal-sun", 1],
      ["deal-sun", 3],
    ]);
  });

  it("sends nothing on days outside every cycle's schedule", async () => {
    await runOverdueReminderCheck(istTick(4), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(7), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(15), { pauseMs: 0 });
    await runOverdueReminderCheck(istTick(22), { pauseMs: 0 });

    expect(sendOverdueReminder).not.toHaveBeenCalled();
    expect(fetchPaymentLink).not.toHaveBeenCalled();
  });

  it("recovers a missed tick on the grace day but never re-sends a stage that already went out", async () => {
    vi.mocked(findUnpaidCycleJobs).mockResolvedValue([
      unpaidJob,
      { ...unpaidJob, id: "job-2", hubspot_deal_id: "deal-2", reminder_1_sent_at: "2026-10-05T05:31:00Z" },
    ]);

    await runOverdueReminderCheck(istTick(6), { pauseMs: 0 }); // grace day for day-5

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

    expect(sent()).toEqual([
      ["deal-1", 1],
      ["deal-2", 1],
    ]);
  });
});
