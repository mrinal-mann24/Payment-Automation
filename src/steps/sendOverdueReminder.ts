import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { sendTextMessage } from "../clients/periskope.js";
import {
  findRenewalJob,
  markReminderSent,
  markReminderSkipped,
  type ReminderStage,
} from "../repositories/renewalJobs.js";

export interface SendOverdueReminderResult {
  sent: boolean;
  skipReason: string | null;
}

// Wording not yet confirmed by the business (open item in
// context/features/step5.md) — reasonable placeholder copy, revisit before
// this goes live with real clients.
function reminderMessage(stage: ReminderStage, shortUrl: string): string {
  if (stage === 1) {
    return `Reminder: your renewal payment is still pending. Please pay here: ${shortUrl}`;
  }
  if (stage === 2) {
    return `Second reminder: your renewal payment is overdue. Please pay here at your earliest convenience: ${shortUrl}`;
  }
  return `Final reminder: your renewal payment is significantly overdue. Services will be discontinued if payment is not received shortly. Please pay here: ${shortUrl}`;
}

export async function sendOverdueReminder(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
  stage: ReminderStage,
): Promise<SendOverdueReminderResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.razorpay_step_status !== "done") {
    throw new Error(
      `Cannot run overdue-reminder step for deal ${dealId} (${billingPeriod}): razorpay_step_status is not "done"`,
    );
  }

  if (job.invoice_step_status === "done") {
    return { sent: false, skipReason: null };
  }

  const stageColumn = { 1: job.reminder_1_sent_at, 2: job.reminder_2_sent_at, 3: job.reminder_3_sent_at }[stage];
  if (stageColumn) {
    return { sent: true, skipReason: null };
  }

  if (!job.razorpay_short_url) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing razorpay_short_url`,
    );
  }

  const deal = await fetchDealWithLineItemsAndContact(dealId);

  if (!deal.contactPhone) {
    const reason = `No WhatsApp identifier (contact phone) found for deal ${dealId}`;
    await markReminderSkipped(supabase, job.id, reason);
    return { sent: false, skipReason: reason };
  }

  await sendTextMessage(deal.contactPhone, reminderMessage(stage, job.razorpay_short_url));

  await markReminderSent(supabase, job.id, stage);
  return { sent: true, skipReason: null };
}
