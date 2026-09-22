import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { sendTextMessage } from "../clients/periskope.js";
import {
  claimReminder,
  findRenewalJob,
  markReminderSkipped,
  releaseReminder,
  type ReminderStage,
} from "../repositories/renewalJobs.js";
import { resolveWhatsappRecipient } from "./whatsappRecipient.js";

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

  // Paid by any route means no more reminders for this cycle (REQ-5.7).
  if (job.paid_at || job.invoice_step_status === "done") {
    return { sent: false, skipReason: null };
  }

  const stageSentAt = { 1: job.reminder_1_sent_at, 2: job.reminder_2_sent_at, 3: job.reminder_3_sent_at }[stage];
  if (stageSentAt) {
    return { sent: true, skipReason: null };
  }

  if (!job.razorpay_short_url) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing razorpay_short_url`,
    );
  }

  const deal = await fetchDealWithLineItemsAndContact(dealId);

  const target = await resolveWhatsappRecipient(supabase, dealId, deal.contactPhone);
  if (target.recipient === null) {
    await markReminderSkipped(supabase, job.id, target.skipReason);
    return { sent: false, skipReason: target.skipReason };
  }

  // Claim right before sending: the stage is stamped only if it is still
  // unsent AND the cycle is still unpaid, so a duplicate cron run or a
  // payment that landed a moment ago sends nothing.
  const claimed = await claimReminder(supabase, job.id, stage);
  if (!claimed) {
    return { sent: false, skipReason: null };
  }

  try {
    await sendTextMessage(target.recipient, reminderMessage(stage, job.razorpay_short_url));
  } catch (err) {
    await releaseReminder(supabase, job.id, stage);
    throw err;
  }

  return { sent: true, skipReason: null };
}
