import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVaDealsWithLineItems } from "../clients/hubspot.js";
import { currentBillingCycle, istToday, termBillingCycle } from "../utils/billingCycle.js";
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

// The on-demand quote behind "Quote now" on the admin page and the
// /webhooks/renewal route. Same classification as the daily tick, but the
// catch-up window does not apply: a term that ended weeks ago is quoted
// from the day it ended, because a person has just decided it should be.
// A deal that is not due, has an unsupported term, or is not an active VA
// deal is refused rather than guessed at.
export async function generateRenewalQuote(
  supabase: SupabaseClient,
  dealId: string,
  now: Date = new Date(),
): Promise<GenerateRenewalQuoteOutcome> {
  const listed = (await fetchVaDealsWithLineItems()).find((deal) => deal.dealId === dealId);
  if (!listed) {
    throw new QuoteNotDueError(`deal ${dealId} is not in the active VA deal list`);
  }

  const classification = classifyDeal(listed, istToday(now));
  switch (classification.kind) {
    case "monthly": {
      if (!classification.due) {
        throw new QuoteNotDueError(classification.reason);
      }
      return { kind: "monthly", result: await runRenewalPipeline(supabase, dealId, currentBillingCycle(now)) };
    }
    case "term": {
      if (!classification.due) {
        throw new QuoteNotDueError(classification.reason);
      }
      const cycle = termBillingCycle(classification.periodStart, classification.months, classification.lastPaid);
      return { kind: "term", result: await runRenewalPipeline(supabase, dealId, cycle) };
    }
    case "unsupported":
      throw new QuoteNotDueError(classification.reason);
    case "none":
      // Legacy due-date flow, keyed by HubSpot's billing_cycle + next_renewal_date.
      return { kind: "none", result: await runRenewalPipeline(supabase, dealId) };
  }
}
