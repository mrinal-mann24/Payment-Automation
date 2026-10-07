import type { SupabaseClient } from "@supabase/supabase-js";
import { asWhatsapp, monthYearLabel, reminderMessage } from "../utils/messages.js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { sendTextMessage } from "../clients/periskope.js";
import { findClientPricing } from "../repositories/clientPricing.js";
import {
  claimReminder,
  findEarliestUnpaidCycleStart,
  findRenewalJob,
  markReminderSkipped,
  releaseReminder,
  type ReminderStage,
} from "../repositories/renewalJobs.js";
import { monthsPendingSince } from "../utils/billingCycle.js";
import { resolveWhatsappRecipient } from "./whatsappRecipient.js";

export interface SendOverdueReminderResult {
  sent: boolean;
  skipReason: string | null;
}

// Below this many months pending, the reminder is just "your payment is
// due" — not yet arrears worth calling out as its own line.
const ARREARS_THRESHOLD_MONTHS = 2;

export async function sendOverdueReminder(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
  stage: ReminderStage,
  today: string,
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

  const pricing = await findClientPricing(supabase, dealId);
  const name = pricing?.client_name || null;
  // Arrears count from the deal's earliest unpaid cycle (a new month is
  // quoted while an older one is still open) unless the admin set an override.
  const earliestUnpaid = await findEarliestUnpaidCycleStart(supabase, dealId);
  const pendingSince = pricing?.pending_since_override ?? earliestUnpaid ?? job.service_period_start;
  const monthsPending = pendingSince ? monthsPendingSince(pendingSince, job.term_months ?? 1, today) : 0;
  const arrearsLine =
    monthsPending >= ARREARS_THRESHOLD_MONTHS
      ? `You currently have pending payments for the last ${monthsPending} months (since ${monthYearLabel(pendingSince!)}).`
      : null;

  try {
    await sendTextMessage(target.recipient, asWhatsapp(reminderMessage(stage, job.razorpay_short_url, name, arrearsLine)));
  } catch (err) {
    await releaseReminder(supabase, job.id, stage);
    throw err;
  }

  return { sent: true, skipReason: null };
}
