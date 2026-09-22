import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { emailEstimate } from "../clients/zoho.js";
import { findRenewalJob, markEmailError, markEstimateEmailSent } from "../repositories/renewalJobs.js";
import { servicePeriodFrom } from "../utils/billingCycle.js";

export interface SendEmailResult {
  sent: boolean;
  error: string | null;
}

// Email is best-effort: a delivery failure is recorded on the row
// (email_error) and returned, never thrown, so it can't block the WhatsApp
// send or the rest of the pipeline. estimate_email_sent stays false, so the
// next run retries it.
export async function sendQuoteEmail(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<SendEmailResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job) {
    throw new Error(`Cannot run quote-email step for deal ${dealId} (${billingPeriod}): no renewal_job found`);
  }

  if (job.estimate_email_sent) {
    return { sent: true, error: null };
  }

  if (
    job.razorpay_step_status !== "done" ||
    !job.zoho_estimate_id ||
    !job.zoho_estimate_number ||
    !job.razorpay_short_url
  ) {
    return { sent: false, error: "quote email needs the estimate and payment link first" };
  }

  try {
    const deal = await fetchDealWithLineItemsAndContact(dealId);
    const period = job.service_period_start ? servicePeriodFrom(job.service_period_start, job.term_months ?? 1).narration : null;

    await emailEstimate(job.zoho_estimate_id, {
      to: deal.billingEmail ?? deal.contactEmail,
      subject: `Virtual Accounting quote ${job.zoho_estimate_number}`,
      body: [
        `Dear ${deal.contactName || "Client"},`,
        `Please find attached your Virtual Accounting quote ${job.zoho_estimate_number}${period ? ` (${period})` : ""}.`,
        `You can pay online here: ${job.razorpay_short_url}`,
        "Thank you.",
      ].join("<br><br>"),
    });

    await markEstimateEmailSent(supabase, job.id);
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEmailError(supabase, job.id, `quote email: ${message}`);
    return { sent: false, error: message };
  }
}
