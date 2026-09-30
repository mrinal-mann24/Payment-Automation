import { getSupabaseClient } from "../clients/supabase.js";
import { fetchPaymentLink } from "../clients/razorpay.js";
import { findUnpaidCycleJobs, type ReminderStage, type RenewalJob } from "../repositories/renewalJobs.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { addDays, isSunday, istToday } from "../utils/billingCycle.js";

// Reminders for an unpaid cycle go out on days 5, 9 and 12 of the cycle
// (business decision, 2026-09-29 — replaces the earlier 5/7/9 schedule),
// counted from the day it started. If a stage's calculated date is a
// Sunday, it shifts to the Monday after instead of sending that day. Each
// stage keeps a one-day grace window (computed from the possibly-shifted
// date) so a single missed tick is recovered the next day; a stage is
// never sent twice (reminder_N_sent_at) and only one stage fires per run.
const STAGE_DAY_OF_CYCLE: Record<ReminderStage, number> = { 1: 5, 2: 9, 3: 12 };
const GRACE_DAYS = 1;

// The calendar date a stage is due: day N of the cycle = start + (N-1)
// days, shifted one day forward when that lands on a Sunday. The 3-day
// minimum gap between stages (9 -> 12) is bigger than the shift (1 day)
// plus the grace window (1 day), so stage windows can never collide.
export function dueDateForStage(cycleStart: string, stage: ReminderStage): string {
  const raw = addDays(cycleStart, STAGE_DAY_OF_CYCLE[stage] - 1);
  return isSunday(raw) ? addDays(raw, 1) : raw;
}

export function reminderStageForJob(job: RenewalJob, today: string): ReminderStage | null {
  if (!job.service_period_start) {
    return null; // legacy row: no cycle, no reminders
  }
  for (const stage of [1, 2, 3] as ReminderStage[]) {
    const due = dueDateForStage(job.service_period_start, stage);
    if (today >= due && today <= addDays(due, GRACE_DAYS)) {
      return stage;
    }
  }
  return null;
}

// Same one-number-sends-many pacing as the cycle generator.
const DEFAULT_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stageAlreadySent(job: RenewalJob, stage: ReminderStage): boolean {
  return Boolean({ 1: job.reminder_1_sent_at, 2: job.reminder_2_sent_at, 3: job.reminder_3_sent_at }[stage]);
}

export async function runOverdueReminderCheck(
  now: Date = new Date(),
  options: { pauseMs?: number } = {},
): Promise<void> {
  const today = istToday(now);
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const supabase = getSupabaseClient();
  const unpaid = await findUnpaidCycleJobs(supabase);
  const due = unpaid.flatMap((job) => {
    const stage = reminderStageForJob(job, today);
    return stage && !stageAlreadySent(job, stage) ? [{ job, stage }] : [];
  });
  console.log(`[reminderCron] ${today}: ${unpaid.length} unpaid cycle(s), ${due.length} due a reminder`);

  let attempted = 0;
  for (const { job, stage } of due) {
    if (attempted > 0 && pauseMs > 0) {
      await sleep(pauseMs);
    }
    attempted++;

    try {
      // Lost-webhook guard: if Razorpay already has the money, settle the
      // cycle instead of chasing the client for it.
      if (job.razorpay_payment_link_id) {
        const link = await fetchPaymentLink(job.razorpay_payment_link_id);
        if (link.status === "paid") {
          console.log(
            `[reminderCron] deal ${job.hubspot_deal_id} (${job.billing_period}) -> link already paid on Razorpay, settling instead of reminding`,
          );
          await settleRenewalPayment(supabase, job, {
            method: "razorpay",
            amount: null,
            paymentDate: today,
            narration: "payment found on Razorpay by the reminder check (webhook not received)",
            reference: null,
          });
          continue;
        }
      }

      const { sent, skipReason } = await sendOverdueReminder(supabase, job.hubspot_deal_id, job.billing_period, stage, today);
      console.log(
        sent
          ? `[reminderCron] deal ${job.hubspot_deal_id} (${job.billing_period}) -> reminder ${stage} sent`
          : `[reminderCron] deal ${job.hubspot_deal_id} (${job.billing_period}) -> reminder ${stage} not sent${skipReason ? `: ${skipReason}` : ""}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reminderCron] deal ${job.hubspot_deal_id} (${job.billing_period}) failed: ${message}`);
    }
  }
}
