import type { SupabaseClient } from "@supabase/supabase-js";
import { findRenewalJob, markHubspotUpdated } from "../repositories/renewalJobs.js";

// No HubSpot deal-stage change happens here: the VA pipeline has no
// "Quote Sent" stage, and moving to "Renewal Done" belongs to step 4
// (actual payment confirmation), not step 3 (quote sent). This step only
// marks the renewal_job done, per REQ-3.6.
export async function updateHubspotDeal(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<void> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job) {
    throw new Error(`Cannot run HubSpot update step for deal ${dealId} (${billingPeriod}): no renewal_job found`);
  }

  if (job.hubspot_updated) {
    return;
  }

  await markHubspotUpdated(supabase, job.id);
}
