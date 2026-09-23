import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVaDealsWithLineItems } from "../clients/hubspot.js";
import { findClientPricing } from "../repositories/clientPricing.js";
import { billingCycleFrom, istToday } from "../utils/billingCycle.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";
import { runRenewalPipeline, type RenewalPipelineResult } from "./renewalPipeline.js";

export class QuoteNotDueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteNotDueError";
  }
}

export interface GenerateRenewalQuoteOutcome {
  kind: DealClassification["kind"];
  result: RenewalPipelineResult;
}

// The on-demand quote behind the secret-protected /webhooks/renewal route.
// Same classification as the daily tick, but the catch-up window does not
// apply: a Next Renewal Date that passed weeks ago is quoted from that
// date, because a person has just decided it should be. A deal that is not
// due or is not an active VA deal is refused.
export async function generateRenewalQuote(
  supabase: SupabaseClient,
  dealId: string,
  now: Date = new Date(),
): Promise<GenerateRenewalQuoteOutcome> {
  const listed = (await fetchVaDealsWithLineItems()).find((deal) => deal.dealId === dealId);
  if (!listed) {
    throw new QuoteNotDueError(`deal ${dealId} is not in the active VA deal list`);
  }

  // The admin's switch applies here too, so a paused client is never quoted by accident.
  const pricing = await findClientPricing(supabase, dealId);
  if (pricing && !pricing.auto_quote) {
    throw new QuoteNotDueError(`automatic quotes are paused for deal ${dealId} on the admin page; switch them back on to quote`);
  }

  const classification = classifyDeal(listed, istToday(now));
  switch (classification.kind) {
    case "cycle": {
      if (!classification.due) {
        throw new QuoteNotDueError(classification.reason);
      }
      const cycle = billingCycleFrom(classification.periodStart, classification.months, classification.amount);
      return { kind: "cycle", result: await runRenewalPipeline(supabase, dealId, cycle) };
    }
    case "none":
      // Legacy due-date flow, keyed by HubSpot's billing_cycle + next_renewal_date.
      return { kind: "none", result: await runRenewalPipeline(supabase, dealId) };
  }
}
