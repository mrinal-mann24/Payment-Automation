import { getSupabaseClient } from "../clients/supabase.js";
import { fetchVaDealsWithLineItems, type VaDealWithLineItems } from "../clients/hubspot.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";
import { currentBillingCycle, istDayOfMonth, type BillingCycle } from "../utils/billingCycle.js";
import { runRenewalPipeline } from "./renewalPipeline.js";

export interface ClassifiedDeal extends VaDealWithLineItems {
  classification: DealClassification;
}

export interface ClassifiedVaDeals {
  cycle: BillingCycle;
  day: number; // IST day of month of the tick
  deals: ClassifiedDeal[];
}

// Quotes go out on the 1st, but a missed tick is retried through the 4th —
// the first reminder is on the 5th, so a quote always precedes it.
const GENERATION_WINDOW_LAST_DAY = 4;
// One WhatsApp number sends ~15 document messages in a row on the 1st;
// pause between deals rather than burst.
const DEFAULT_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HubSpot listing per tick, shared with the legacy cron so the two can
// never disagree about which deals are monthly.
export async function classifyVaDeals(now: Date = new Date()): Promise<ClassifiedVaDeals> {
  const cycle = currentBillingCycle(now);
  const deals = await fetchVaDealsWithLineItems();
  return {
    cycle,
    day: istDayOfMonth(now),
    deals: deals.map((deal) => ({ ...deal, classification: classifyDeal(deal, cycle.period.start) })),
  };
}

export async function runMonthlyBillingCheck(
  classified: ClassifiedVaDeals,
  options: { pauseMs?: number } = {},
): Promise<void> {
  const { cycle, day, deals } = classified;
  if (day > GENERATION_WINDOW_LAST_DAY) {
    console.log(`[monthlyBilling] IST day ${day} is outside the 1st-${GENERATION_WINDOW_LAST_DAY} generation window`);
    return;
  }

  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const supabase = getSupabaseClient();
  console.log(`[monthlyBilling] cycle ${cycle.key}: checking ${deals.length} active VA deal(s)`);

  let attempted = 0;
  for (const deal of deals) {
    const classification = deal.classification;
    if (!(classification.monthly && classification.due)) {
      console.log(`[monthlyBilling] deal ${deal.dealId} (${deal.dealName}) -> skipped: ${classification.reason}`);
      continue;
    }

    if (attempted > 0 && pauseMs > 0) {
      await sleep(pauseMs);
    }
    attempted++;

    try {
      // A deal whose data was fixed mid-month may still have an unpaid
      // quote from the legacy flow; never ask for two overlapping payments.
      const openLegacy = await findOpenLegacyJob(supabase, deal.dealId);
      if (openLegacy) {
        console.log(
          `[monthlyBilling] deal ${deal.dealId} (${deal.dealName}) -> skipped: unpaid legacy quote ${openLegacy.zoho_estimate_number} (${openLegacy.billing_period}) is still open`,
        );
        continue;
      }

      const result = await runRenewalPipeline(supabase, deal.dealId, cycle);
      console.log(
        `[monthlyBilling] deal ${deal.dealId} (${deal.dealName}) -> estimate ${result.zohoEstimateNumber}, link ${result.shortUrl}, ` +
          `WhatsApp ${result.periskopeSent ? "sent" : `skipped: ${result.periskopeSkipReason}`}, ` +
          `email ${result.emailSent ? "sent" : `not sent: ${result.emailError}`}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[monthlyBilling] deal ${deal.dealId} (${deal.dealName}) failed: ${message}`);
    }
  }
}
