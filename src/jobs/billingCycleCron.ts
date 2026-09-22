import { getSupabaseClient } from "../clients/supabase.js";
import { fetchVaDealsWithLineItems, type VaDealWithLineItems } from "../clients/hubspot.js";
import { findOpenLegacyJob } from "../repositories/renewalJobs.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";
import {
  currentBillingCycle,
  daysBetween,
  istDayOfMonth,
  istToday,
  termBillingCycle,
  type BillingCycle,
} from "../utils/billingCycle.js";
import { runRenewalPipeline } from "./renewalPipeline.js";

export interface ClassifiedDeal extends VaDealWithLineItems {
  classification: DealClassification;
}

export interface ClassifiedVaDeals {
  cycle: BillingCycle; // the current calendar month, for monthly deals
  today: string; // IST date of the tick
  day: number; // IST day of month of the tick
  deals: ClassifiedDeal[];
}

// A quote goes out the day a cycle starts — the 1st for monthly deals, the
// day the last term ended for quarterly / half-yearly ones — and a missed
// tick is retried for three more days. Anything older waits for "Quote
// now" on the admin page: a client whose HubSpot record is merely behind is
// never chased automatically. Monthly reminders start on the 5th, so a
// monthly quote always precedes them.
export const GENERATION_WINDOW_DAYS = 4;
// One WhatsApp number sends ~15 document messages in a row on the 1st;
// pause between deals rather than burst.
const DEFAULT_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HubSpot listing per tick, shared with the legacy cron so the two can
// never disagree about which deals the cycles own.
export async function classifyVaDeals(now: Date = new Date()): Promise<ClassifiedVaDeals> {
  const today = istToday(now);
  const deals = await fetchVaDealsWithLineItems();
  return {
    cycle: currentBillingCycle(now),
    today,
    day: istDayOfMonth(now),
    deals: deals.map((deal) => ({ ...deal, classification: classifyDeal(deal, today) })),
  };
}

// Monthly, term and unsupported deals all belong to the cycle logic; only
// "none" (yearly, no usable line item) is left to the legacy due-date cron.
export function isBilledByCycles(classification: DealClassification): boolean {
  return classification.kind !== "none";
}

// Which cycle, if any, the daily tick should generate for a deal right now.
export function cycleToGenerate(
  classification: DealClassification,
  tick: Pick<ClassifiedVaDeals, "cycle" | "today" | "day">,
): { cycle: BillingCycle; reason: null } | { cycle: null; reason: string } {
  if (classification.kind === "monthly") {
    if (!classification.due) {
      return { cycle: null, reason: classification.reason };
    }
    if (tick.day > GENERATION_WINDOW_DAYS) {
      return { cycle: null, reason: `IST day ${tick.day} is outside the 1st-${GENERATION_WINDOW_DAYS}th window; use Quote now` };
    }
    return { cycle: tick.cycle, reason: null };
  }
  if (classification.kind === "term") {
    if (!classification.due) {
      return { cycle: null, reason: classification.reason };
    }
    const age = daysBetween(classification.periodStart, tick.today);
    if (age >= GENERATION_WINDOW_DAYS) {
      return {
        cycle: null,
        reason: `term ended ${classification.periodStart}, ${age} days ago — outside the ${GENERATION_WINDOW_DAYS}-day window; use Quote now`,
      };
    }
    return { cycle: termBillingCycle(classification.periodStart, classification.months, classification.lastPaid), reason: null };
  }
  return { cycle: null, reason: classification.reason };
}

export async function runBillingCycleCheck(
  classified: ClassifiedVaDeals,
  options: { pauseMs?: number } = {},
): Promise<void> {
  const { deals } = classified;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const supabase = getSupabaseClient();
  console.log(`[billingCycle] ${classified.today}: checking ${deals.length} active VA deal(s)`);

  let attempted = 0;
  for (const deal of deals) {
    const { cycle, reason } = cycleToGenerate(deal.classification, classified);
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
