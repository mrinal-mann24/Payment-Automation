import { getSupabaseClient } from "../clients/supabase.js";
import { findPaidUnsettledAdditionCharges } from "../repositories/additionCharges.js";
import { findPaidUnsettledJobs } from "../repositories/renewalJobs.js";
import { settleAdditionPayment } from "../steps/settleAdditionPayment.js";
import { settleRenewalPayment } from "../steps/settleRenewalPayment.js";

// Daily: finish any paid cycle or one-time quote whose invoice / Zoho
// payment / confirmation / email / HubSpot step is still outstanding.
// Razorpay payments get webhook retries; manual payments do not, so this
// is their retry.
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

  const charges = await findPaidUnsettledAdditionCharges(supabase);
  console.log(`[settlementSweep] ${charges.length} paid one-time quote(s) with unfinished settlement steps`);

  for (const charge of charges) {
    try {
      const result = await settleAdditionPayment(supabase, charge, null);
      console.log(
        `[settlementSweep] one-time quote ${charge.zoho_estimate_number} (deal ${charge.hubspot_deal_id}) -> ${result.errors.length ? `still outstanding: ${result.errors.join("; ")}` : "settled"}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[settlementSweep] one-time quote ${charge.zoho_estimate_number} (deal ${charge.hubspot_deal_id}) failed: ${message}`);
    }
  }
}
