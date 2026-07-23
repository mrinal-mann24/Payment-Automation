import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { createEstimate, findOrCreateCustomer } from "../clients/zoho.js";
import {
  createRenewalJob,
  findRenewalJob,
  markZohoStepDone,
  markZohoStepFailed,
} from "../repositories/renewalJobs.js";

export interface CreateZohoEstimateResult {
  zohoEstimateId: string;
  zohoEstimateNumber: string;
  zohoEstimateTotal: number;
  billingPeriod: string;
}

export async function createZohoEstimate(
  supabase: SupabaseClient,
  dealId: string,
): Promise<CreateZohoEstimateResult> {
  const deal = await fetchDealWithLineItemsAndContact(dealId);

  const existingJob = await findRenewalJob(supabase, dealId, deal.billingPeriod);
  if (existingJob?.zoho_step_status === "done" && existingJob.zoho_estimate_id) {
    return {
      zohoEstimateId: existingJob.zoho_estimate_id,
      zohoEstimateNumber: existingJob.zoho_estimate_number ?? "",
      zohoEstimateTotal: existingJob.zoho_estimate_total ?? 0,
      billingPeriod: deal.billingPeriod,
    };
  }

  const job = existingJob ?? (await createRenewalJob(supabase, dealId, deal.billingPeriod));

  try {
    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    const { estimateId, estimateNumber, total } = await createEstimate(customerId, deal);
    await markZohoStepDone(supabase, job.id, estimateId, estimateNumber, total);
    return {
      zohoEstimateId: estimateId,
      zohoEstimateNumber: estimateNumber,
      zohoEstimateTotal: total,
      billingPeriod: deal.billingPeriod,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markZohoStepFailed(supabase, job.id, message);
    throw err;
  }
}
