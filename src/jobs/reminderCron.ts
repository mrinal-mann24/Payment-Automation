import { getSupabaseClient } from "../clients/supabase.js";
import { findOverdueUnpaidJobs, type RenewalJob, type ReminderStage } from "../repositories/renewalJobs.js";
import { sendOverdueReminder } from "../steps/sendOverdueReminder.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// billing_period is built (src/clients/hubspot.ts) as
// `${billing_cycle}-${next_renewal_date}`, and next_renewal_date is always a
// plain YYYY-MM-DD string — so the trailing 3 dash-separated segments are
// always the due date, regardless of billing_cycle's own value (Monthly /
// Quarterly / Annual, none of which contain a dash). Resolves the open item
// in context/features/step5.md.
export function parseDueDate(billingPeriod: string): Date | null {
  const match = billingPeriod.match(/(\d{4}-\d{2}-\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysOverdue(dueDate: Date): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((todayUtc - dueDate.getTime()) / MS_PER_DAY);
}

const REMINDER_SCHEDULE: Array<{ stage: ReminderStage; atDaysOverdue: number }> = [
  { stage: 1, atDaysOverdue: 2 },
  { stage: 2, atDaysOverdue: 4 },
  { stage: 3, atDaysOverdue: 7 },
];

export function nextDueStage(job: RenewalJob, overdueDays: number): ReminderStage | null {
  const sentAt: Record<ReminderStage, string | null> = {
    1: job.reminder_1_sent_at,
    2: job.reminder_2_sent_at,
    3: job.reminder_3_sent_at,
  };

  for (const { stage, atDaysOverdue } of REMINDER_SCHEDULE) {
    if (overdueDays === atDaysOverdue && !sentAt[stage]) {
      return stage;
    }
  }
  return null;
}

export async function runOverdueReminderCheck(): Promise<void> {
  const supabase = getSupabaseClient();
  const jobs = await findOverdueUnpaidJobs(supabase);
  console.log(`[reminderCron] ${jobs.length} overdue-and-unpaid renewal_job(s) to check`);

  for (const job of jobs) {
    try {
      const dueDate = parseDueDate(job.billing_period);
      if (!dueDate) {
        console.error(
          `[reminderCron] job ${job.id} (deal ${job.hubspot_deal_id}) -> skipped, could not parse due date from billing_period "${job.billing_period}"`,
        );
        continue;
      }

      const overdueDays = daysOverdue(dueDate);
      const stage = nextDueStage(job, overdueDays);
      if (!stage) {
        continue;
      }

      const { sent, skipReason } = await sendOverdueReminder(
        supabase,
        job.hubspot_deal_id,
        job.billing_period,
        stage,
      );
      console.log(
        sent
          ? `[reminderCron] job ${job.id} (deal ${job.hubspot_deal_id}) -> reminder ${stage} sent`
          : `[reminderCron] job ${job.id} (deal ${job.hubspot_deal_id}) -> reminder ${stage} skipped: ${skipReason}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reminderCron] job ${job.id} (deal ${job.hubspot_deal_id}) failed: ${message}`);
    }
  }
}
