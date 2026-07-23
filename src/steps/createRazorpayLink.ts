import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentLink } from "../clients/razorpay.js";
import {
  findRenewalJob,
  markRazorpayStepDone,
  markRazorpayStepFailed,
} from "../repositories/renewalJobs.js";

export interface CreateRazorpayLinkResult {
  paymentLinkId: string;
  shortUrl: string;
}

export async function createRazorpayLink(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<CreateRazorpayLinkResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.zoho_step_status !== "done") {
    throw new Error(
      `Cannot run Razorpay step for deal ${dealId} (${billingPeriod}): zoho_step_status is not "done"`,
    );
  }

  if (job.razorpay_step_status === "done" && job.razorpay_payment_link_id && job.razorpay_short_url) {
    return {
      paymentLinkId: job.razorpay_payment_link_id,
      shortUrl: job.razorpay_short_url,
    };
  }

  if (!job.zoho_estimate_number || job.zoho_estimate_total == null) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing zoho_estimate_number or zoho_estimate_total`,
    );
  }

  const amountPaise = Math.round(job.zoho_estimate_total * 100);

  try {
    const { paymentLinkId, shortUrl } = await createPaymentLink(
      job.zoho_estimate_number,
      amountPaise,
      `Renewal payment for estimate ${job.zoho_estimate_number}`,
    );
    await markRazorpayStepDone(supabase, job.id, paymentLinkId, shortUrl);
    return { paymentLinkId, shortUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markRazorpayStepFailed(supabase, job.id, message);
    throw err;
  }
}
