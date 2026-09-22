import { getSupabaseClient } from "../clients/supabase.js";
import { findPaidUnsettledJobs } from "../repositories/renewalJobs.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";

// Daily: finish any paid cycle whose invoice / confirmation / email /
// HubSpot step is still outstanding. Razorpay payments get webhook retries;
// manual payments do not, so this is their retry.
export async function runSettlementSweep(): Promise<void> {
  const supabase = getSupabaseClient();
  const jobs = await findPaidUnsettledJobs(supabase);
  console.log(`[settlementSweep] ${jobs.length} paid cycle(s) with unfinished settlement steps`);

  for (const job of jobs) {
    try {
      const result = await settleRenewalPayment(supabase, job, null);
      console.log(
        `[settlementSweep] deal ${job.hubspot_deal_id} (${job.billing_period}) -> ${result.errors.length ? `still outstanding: ${result.errors.join("; ")}` : "settled"}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[settlementSweep] deal ${job.hubspot_deal_id} (${job.billing_period}) failed: ${message}`);
    }
  }
}
