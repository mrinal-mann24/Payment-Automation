import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { createEstimate, findOrCreateCustomer } from "../clients/zoho.js";
import {
  claimZohoStep,
  createRenewalJob,
  findRenewalJob,
  markZohoStepDone,
  markZohoStepFailed,
} from "../repositories/renewalJobs.js";
import { findClientPricing, upsertClientPricing } from "../repositories/clientPricing.js";
import type { BillingCycle } from "../utils/billingCycle.js";

export interface CreateZohoEstimateResult {
  zohoEstimateId: string;
  zohoEstimateNumber: string;
  zohoEstimateTotal: number;
  billingPeriod: string;
}

// `cycle` selects the monthly flow: the renewal_jobs row is keyed by
// calendar month (YYYY-MM) and the quote reads "Virtual Accounting /
// Service period: …". Without it the legacy due-date flow runs unchanged,
// keyed by HubSpot's billing_cycle + next_renewal_date.
export async function createZohoEstimate(
  supabase: SupabaseClient,
  dealId: string,
  cycle?: BillingCycle,
): Promise<CreateZohoEstimateResult> {
  const deal = await fetchDealWithLineItemsAndContact(dealId);

  const billingPeriod = cycle?.key ?? deal.billingPeriod;
  if (!billingPeriod) {
    throw new Error(`HubSpot deal ${dealId} is missing billing_cycle or next_renewal_date`);
  }
  const referenceNumber = cycle ? `${dealId}/${cycle.key}` : dealId;

  const existingJob = await findRenewalJob(supabase, dealId, billingPeriod);
  if (existingJob?.zoho_step_status === "done" && existingJob.zoho_estimate_id) {
    return {
      zohoEstimateId: existingJob.zoho_estimate_id,
      zohoEstimateNumber: existingJob.zoho_estimate_number ?? "",
      zohoEstimateTotal: existingJob.zoho_estimate_total ?? 0,
      billingPeriod,
    };
  }

  const job = existingJob ?? (await createRenewalJob(supabase, dealId, billingPeriod));

  if (job.zoho_step_status === "creating") {
    // A previous run claimed this step and then crashed/died before
    // recording the result — Zoho has no idempotency key on /estimates, so
    // this can't be safely auto-resolved. Surface it loudly instead of
    // silently creating a second real estimate; check Zoho for an
    // estimate with this reference_number before retrying manually.
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is stuck in "creating" — ` +
        `a previous run may have created a Zoho estimate that was never recorded. ` +
        `Check Zoho for an estimate with reference_number "${referenceNumber}" before retrying.`,
    );
  }

  if (job.zoho_step_status === "pending") {
    const claimed = await claimZohoStep(supabase, job.id);
    if (!claimed) {
      // Lost the claim race to a concurrent run for the same deal — refetch
      // and let the normal "already done" short-circuit above handle it on
      // the caller's next attempt rather than also calling Zoho here.
      throw new Error(
        `Could not claim Zoho estimate step for deal ${dealId} (${billingPeriod}); ` +
          `a concurrent run is already creating it`,
      );
    }
  }

  try {
    // client_pricing is the source of truth for the renewal base price,
    // once set — it takes over from HubSpot's line item price. On the
    // legacy path, no row yet (new/unmigrated deal) falls back to HubSpot's
    // existing lineItems[0], unchanged from before. A monthly cycle never
    // guesses: HubSpot's association order is undefined, so lineItems[0]
    // is not a safe price source for an automatic monthly charge.
    // One-off additions are billed separately via their own quote+link
    // flow (src/steps/createAdditionCharge.ts), never folded into the
    // renewal total.
    const pricing = await findClientPricing(supabase, dealId);
    if (cycle && !pricing) {
      throw new Error(
        `No client_pricing row for deal ${dealId}; refusing to guess a price for monthly cycle ${cycle.key}`,
      );
    }

    let dealForEstimate = deal;
    if (pricing) {
      const firstLineItem = deal.lineItems[0];
      dealForEstimate = {
        ...deal,
        lineItems: [
          {
            id: firstLineItem?.id ?? "",
            name: firstLineItem?.name ?? deal.dealName,
            quantity: firstLineItem?.quantity ?? 1,
            price: pricing.base_price,
          },
        ],
      };
    }

    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    const estimateCycle = cycle ? { key: cycle.key, narration: cycle.period.narration } : undefined;
    const { estimateId, estimateNumber, total } = await createEstimate(customerId, dealForEstimate, estimateCycle);

    // createEstimate has already thrown if there was no line item to bill.
    const billedPrice = dealForEstimate.lineItems[0]!.price;
    await markZohoStepDone(supabase, job.id, estimateId, estimateNumber, total, {
      price: billedPrice,
      servicePeriodStart: cycle?.period.start ?? null,
    });
    return {
      zohoEstimateId: estimateId,
      zohoEstimateNumber: estimateNumber,
      zohoEstimateTotal: total,
      billingPeriod,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markZohoStepFailed(supabase, job.id, message);
    throw err;
  }
}
