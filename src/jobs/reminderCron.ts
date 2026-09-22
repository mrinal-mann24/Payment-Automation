import { getSupabaseClient } from "../clients/supabase.js";
import { fetchPaymentLink } from "../clients/razorpay.js";
import { findUnpaidMonthlyJobs, type ReminderStage, type RenewalJob } from "../repositories/renewalJobs.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { billingMonthKey, istDayOfMonth, istToday } from "../utils/billingCycle.js";

// Reminders for an unpaid monthly cycle go out on the 5th, 7th and 9th of
// the month being billed. Each stage keeps a one-day grace window so a
// single missed tick is recovered the next day; a stage is never sent
// twice (reminder_N_sent_at) and only one stage fires per run.
export function reminderStageForDay(day: number): ReminderStage | null {
  if (day === 5 || day === 6) return 1;
  if (day === 7 || day === 8) return 2;
  if (day === 9 || day === 10) return 3;
  return null;
}

// Same one-number-sends-many pacing as the monthly generator.
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
  const stage = reminderStageForDay(istDayOfMonth(now));
  if (!stage) {
    return;
  }

  const monthKey = billingMonthKey(now);
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const supabase = getSupabaseClient();
  const jobs = await findUnpaidMonthlyJobs(supabase, monthKey);
  console.log(`[reminderCron] ${jobs.length} unpaid ${monthKey} cycle(s) to check for reminder stage ${stage}`);

  let attempted = 0;
  for (const job of jobs) {
    if (stageAlreadySent(job, stage)) {
      continue;
    }

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
            paymentDate: istToday(now),
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
