import { getSupabaseClient } from "../clients/supabase.js";
import { fetchVaDealsWithLineItems, type VaDealWithLineItems } from "../clients/hubspot.js";
import { findPausedDealIds } from "../repositories/clientPricing.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";
import { billingCycleFrom, daysBetween, istToday, type BillingCycle } from "../utils/billingCycle.js";
import { runRenewalPipeline } from "./renewalPipeline.js";

export interface ClassifiedDeal extends VaDealWithLineItems {
  classification: DealClassification;
}

export interface ClassifiedVaDeals {
  today: string; // IST date of the tick
  deals: ClassifiedDeal[];
  paused: Set<string>; // deals whose automatic quotes the admin switched off
}

// A quote goes out on the client's Next Renewal Date and a missed tick is
// retried for three more days. Anything older is never auto-quoted: the
// admin page flags it and the team corrects the date in HubSpot, so a
// client whose record is merely behind is not chased automatically.
export const GENERATION_WINDOW_DAYS = 4;
// One WhatsApp number sends many document messages in a row on the 1st;
// pause between deals rather than burst.
const DEFAULT_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HubSpot listing per tick, shared with the legacy cron so the two can
// never disagree about which deals the cycles own.
export async function classifyVaDeals(now: Date = new Date()): Promise<ClassifiedVaDeals> {
  const today = istToday(now);
  const [deals, paused] = await Promise.all([fetchVaDealsWithLineItems(), findPausedDealIds(getSupabaseClient())]);
  return {
    today,
    paused,
    deals: deals.map((deal) => ({ ...deal, classification: classifyDeal(deal, today) })),
  };
}

// Only "none" (a year or longer, no usable line item) is left to the
// legacy due-date cron.
export function isBilledByCycles(classification: DealClassification): boolean {
  return classification.kind !== "none";
}

// Which cycle, if any, the daily tick should generate for a deal right now.
export function cycleToGenerate(
  classification: DealClassification,
  today: string,
): { cycle: BillingCycle; reason: null } | { cycle: null; reason: string } {
  if (classification.kind !== "cycle" || !classification.due) {
    return { cycle: null, reason: classification.reason };
  }
  const age = daysBetween(classification.periodStart, today);
  if (age >= GENERATION_WINDOW_DAYS) {
    return {
      cycle: null,
      reason: `Next Renewal Date ${classification.periodStart} passed ${age} days ago without a quote — outside the ${GENERATION_WINDOW_DAYS}-day window; update it in HubSpot`,
    };
  }
  return { cycle: billingCycleFrom(classification.periodStart, classification.months, classification.amount), reason: null };
}

export async function runBillingCycleCheck(
  classified: ClassifiedVaDeals,
  options: { pauseMs?: number } = {},
): Promise<void> {
  const { today, deals, paused } = classified;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const supabase = getSupabaseClient();
  console.log(`[billingCycle] ${today}: checking ${deals.length} active VA deal(s)`);

  let attempted = 0;
  for (const deal of deals) {
    if (paused.has(deal.dealId)) {
      console.log(`[billingCycle] deal ${deal.dealId} (${deal.dealName}) -> skipped: automatic quotes are paused on the admin page`);
      continue;
    }
    const { cycle, reason } = cycleToGenerate(deal.classification, today);
    if (!cycle) {
      console.log(`[billingCycle] deal ${deal.dealId} (${deal.dealName}) -> skipped: ${reason}`);
      continue;
    }

    if (attempted > 0 && pauseMs > 0) {
      await sleep(pauseMs);
    }
    attempted++;

    try {
      // A deal whose data was fixed mid-cycle may still have an unpaid
      // quote from the legacy flow; never ask for two overlapping payments.
      const openLegacy = await findOpenLegacyJob(supabase, deal.dealId);
      if (openLegacy) {
        console.log(
          `[billingCycle] deal ${deal.dealId} (${deal.dealName}) -> skipped: unpaid legacy quote ${openLegacy.zoho_estimate_number} (${openLegacy.billing_period}) is still open`,
        );
        continue;
      }

      const result = await runRenewalPipeline(supabase, deal.dealId, cycle);
      console.log(
        `[billingCycle] deal ${deal.dealId} (${deal.dealName}) cycle ${cycle.key} -> estimate ${result.zohoEstimateNumber}, link ${result.shortUrl}, ` +
          `WhatsApp ${result.periskopeSent ? "sent" : `skipped: ${result.periskopeSkipReason}`}, ` +
          `email ${result.emailSent ? "sent" : `not sent: ${result.emailError}`}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[billingCycle] deal ${deal.dealId} (${deal.dealName}) failed: ${message}`);
    }
  }
}
