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
import { cleanLineItemName, latestRecurringLineItem } from "../utils/monthlyEligibility.js";

export interface CreateZohoEstimateResult {
  zohoEstimateId: string;
  zohoEstimateNumber: string;
  zohoEstimateTotal: number;
  billingPeriod: string;
}

// `cycle` selects the monthly flow: the renewal_jobs row is keyed by
// calendar month (YYYY-MM) and the quote line is named after the priced
// HubSpot line item (e.g. "All VA Services / Service period: …"). Without
// `cycle` the legacy due-date flow runs unchanged, keyed by HubSpot's
// billing_cycle + next_renewal_date.
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
    // HubSpot is the price: the recurring line item with the latest billing
    // start date, unit price × quantity (decision 2026-09-28). The
    // client_pricing base price per month is only the fallback for a line
    // item that carries no price. With neither, nothing is billed rather
    // than guessed. One-off additions are billed separately
    // (src/steps/createAdditionCharge.ts), never folded into the renewal.
    const pricing = await findClientPricing(supabase, dealId);
    const basePrice = pricing?.base_price ?? null;
    // The line item that prices this cycle is also where its narration
    // comes from: the accountant's own Description on it, when set
    // (decision 2026-09-29). Blank/whitespace falls back to the
    // auto-generated service-period text, unchanged from before.
    const latest = latestRecurringLineItem(deal.lineItems);
    const narration = latest?.description?.trim() || undefined;

    let dealForEstimate = deal;
    if (cycle) {
      const price = cycle.amount ?? (basePrice === null ? null : basePrice * cycle.months);
      if (price === null) {
        throw new Error(
          `No price on the HubSpot line item and no base price in client_pricing for deal ${dealId}; refusing to guess a price for cycle ${cycle.key}`,
        );
      }
      // The quote's line is named after the HubSpot line item that priced
      // it (decision 2026-09-29 — the accountant's own name, e.g. "All VA
      // Services"), with a cloned item's accumulated "(Copy)" suffix
      // stripped, falling back to "Virtual Accounting" only when there is
      // no matching item to name it after.
      const quoteLineName = (latest?.name && cleanLineItemName(latest.name)) || "Virtual Accounting";
      dealForEstimate = { ...deal, lineItems: [{ id: "", name: quoteLineName, quantity: 1, price }] };
    } else {
      if (latest && latest.price > 0) {
        dealForEstimate = { ...deal, lineItems: [{ ...latest, name: cleanLineItemName(latest.name) }] };
      } else if (basePrice !== null) {
        const firstLineItem = latest ?? deal.lineItems[0];
        dealForEstimate = {
          ...deal,
          lineItems: [
            {
              id: firstLineItem?.id ?? "",
              name: cleanLineItemName(firstLineItem?.name) ?? deal.dealName,
              quantity: firstLineItem?.quantity ?? 1,
              price: basePrice,
            },
          ],
        };
      }
    }

    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    const estimateLine = cycle ? { key: cycle.key, description: narration ?? cycle.period.narration } : undefined;
    const { estimateId, estimateNumber, total } = await createEstimate(customerId, dealForEstimate, estimateLine);

    // createEstimate has already thrown if there was no line item to bill.
    const billedPrice = dealForEstimate.lineItems[0]!.price;
    await markZohoStepDone(supabase, job.id, estimateId, estimateNumber, total, {
      price: billedPrice,
      servicePeriodStart: cycle?.period.start ?? null,
      termMonths: cycle?.months ?? null,
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
