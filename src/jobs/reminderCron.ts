import { getSupabaseClient } from "../clients/supabase.js";
import { fetchPaymentLink } from "../clients/razorpay.js";
import { findUnpaidCycleJobs, type ReminderStage, type RenewalJob } from "../repositories/renewalJobs.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { daysBetween, istToday } from "../utils/billingCycle.js";

// Reminders for an unpaid cycle go out on days 5, 7 and 9 of the cycle,
// counted from the day it started: the 5th/7th/9th of the month for a
// monthly cycle (quoted on the 1st), 4/6/8 days after the quote for a
// quarterly or half-yearly one. Each stage keeps a one-day grace window so
// a single missed tick is recovered the next day; a stage is never sent
// twice (reminder_N_sent_at) and only one stage fires per run.
export function reminderStageForDay(dayOfCycle: number): ReminderStage | null {
  if (dayOfCycle === 5 || dayOfCycle === 6) return 1;
  if (dayOfCycle === 7 || dayOfCycle === 8) return 2;
  if (dayOfCycle === 9 || dayOfCycle === 10) return 3;
  return null;
}

export function reminderStageForJob(job: RenewalJob, today: string): ReminderStage | null {
  if (!job.service_period_start) {
    return null; // legacy row: no cycle, no reminders
  }
  return reminderStageForDay(daysBetween(job.service_period_start, today) + 1);
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

      const { sent, skipReason } = await sendOverdueReminder(supabase, job.hubspot_deal_id, job.billing_period, stage);
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
