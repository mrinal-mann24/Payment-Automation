import type { SupabaseClient } from "@supabase/supabase-js";
import { createZohoEstimate } from "../steps/createZohoEstimate.js";
import { createRazorpayLink } from "../steps/createRazorpayLink.js";
import { sendRenewalMessage } from "../steps/sendRenewalMessage.js";
import { sendQuoteEmail } from "../steps/sendQuoteEmail.js";
import { updateHubspotDeal } from "../steps/updateHubspotDeal.js";
import type { BillingCycle } from "../utils/billingCycle.js";

export interface RenewalPipelineResult {
  billingPeriod: string;
  zohoEstimateId: string;
  zohoEstimateNumber: string;
  paymentLinkId: string;
  shortUrl: string;
  periskopeSent: boolean;
  periskopeSkipReason: string | null;
  emailSent: boolean;
  emailError: string | null;
}

// The quote half of a renewal (steps 1-3), shared by the monthly cycle
// generator, the legacy due-date cron and the manual /webhooks/renewal
// route. Each step records its own result in renewal_jobs, so a re-run
// resumes from the first incomplete step. WhatsApp and email are delivery
// channels, not gates: a Periskope throw is recorded and returned so the
// email still goes out and the job is still flagged; periskope_sent stays
// false, so the next run retries the send.
export async function runRenewalPipeline(
  supabase: SupabaseClient,
  dealId: string,
  cycle?: BillingCycle,
): Promise<RenewalPipelineResult> {
  const { zohoEstimateId, zohoEstimateNumber, billingPeriod } = await createZohoEstimate(supabase, dealId, cycle);
  const { paymentLinkId, shortUrl } = await createRazorpayLink(supabase, dealId, billingPeriod);

  let periskopeSent = false;
  let periskopeSkipReason: string | null = null;
  try {
    const sent = await sendRenewalMessage(supabase, dealId, billingPeriod);
    periskopeSent = sent.sent;
    periskopeSkipReason = sent.skipReason;
  } catch (err) {
    periskopeSkipReason = err instanceof Error ? err.message : String(err);
    console.error(`[renewalPipeline] deal ${dealId} (${billingPeriod}) WhatsApp send failed: ${periskopeSkipReason}`);
  }

  const { sent: emailSent, error: emailError } = await sendQuoteEmail(supabase, dealId, billingPeriod);
  await updateHubspotDeal(supabase, dealId, billingPeriod);

  return {
    billingPeriod,
    zohoEstimateId,
    zohoEstimateNumber,
    paymentLinkId,
    shortUrl,
    periskopeSent,
    periskopeSkipReason,
    emailSent,
    emailError,
  };
}
