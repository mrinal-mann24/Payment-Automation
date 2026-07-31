import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact, addLineItemToDeal, type HubspotLineItem } from "../clients/hubspot.js";
import { createEstimate, findOrCreateCustomer } from "../clients/zoho.js";
import {
  createRenewalJob,
  findRenewalJob,
  markZohoStepDone,
  markZohoStepFailed,
} from "../repositories/renewalJobs.js";
import { findClientPricing, upsertClientPricing } from "../repositories/clientPricing.js";

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
    // client_pricing is the source of truth for the renewal base price,
    // once set — it takes over from HubSpot's line item price. No row yet
    // (new/unmigrated deal) falls back to HubSpot's existing lineItems[0],
    // unchanged from before. See ARCHITECTURE.md for why this doesn't
    // create two permanently competing sources of truth: HubSpot is
    // updated with a log line item after the estimate is created, so it
    // always reflects what was billed. One-off additions are billed
    // separately via their own quote+link flow
    // (src/steps/createAdditionCharge.ts), never folded into the renewal
    // total.
    const pricing = await findClientPricing(supabase, dealId);
    let dealForEstimate = deal;
    let billedLineItem: HubspotLineItem | null = null;

    if (pricing) {
      const firstLineItem = deal.lineItems[0];
      billedLineItem = {
        id: firstLineItem?.id ?? "",
        name: firstLineItem?.name ?? deal.dealName,
        quantity: firstLineItem?.quantity ?? 1,
        price: pricing.base_price,
      };
      dealForEstimate = { ...deal, lineItems: [billedLineItem] };
    }

    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    const { estimateId, estimateNumber, total } = await createEstimate(customerId, dealForEstimate);

    if (billedLineItem) {
      await addLineItemToDeal(dealId, {
        name: billedLineItem.name,
        quantity: billedLineItem.quantity,
        price: billedLineItem.price,
      });
    }

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
