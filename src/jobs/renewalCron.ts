import { getSupabaseClient } from "../clients/supabase.js";
import { findDealsWithRenewalDueToday } from "../clients/neon.js";
import { fetchDealStage, VA_ACTIVE_CUSTOMER_DEALSTAGES } from "../clients/hubspot.js";
import { istToday } from "../utils/billingCycle.js";
import { runRenewalPipeline } from "./renewalPipeline.js";

// Legacy due-date flow for deals that no billing cycle owns (yearly, no
// usable line item). `cycleDealIds` comes
// from the same per-tick classification the cycle generator uses: a
// cycle deal's paid line item ends the day its next cycle starts, so Neon
// reports it as "due today" that day, and it must be skipped here or it
// would be quoted twice under two different keys.
export async function runRenewalCheck(cycleDealIds: Set<string>, now: Date = new Date()): Promise<void> {
  const dueDeals = await findDealsWithRenewalDueToday(istToday(now));
  console.log(`[renewalCron] ${dueDeals.length} deal(s) due for renewal today`);

  const supabase = getSupabaseClient();

  for (const deal of dueDeals) {
    try {
      if (cycleDealIds.has(deal.dealId)) {
        console.log(`[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> skipped, billed by its billing cycle`);
        continue;
      }

      // Neon's line_items table has no dealstage column, so re-check the
      // deal's real, current stage directly against HubSpot before running
      // the pipeline — only active customers (Ready for Renewal / Renewal
      // Done / Payment Done) should be billed automatically.
      const dealStage = await fetchDealStage(deal.dealId);
      if (!VA_ACTIVE_CUSTOMER_DEALSTAGES.includes(dealStage)) {
        console.log(
          `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> skipped, dealstage ${dealStage} is not an active-customer stage`,
        );
        continue;
      }

      const result = await runRenewalPipeline(supabase, deal.dealId);
      console.log(
        `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> estimate ${result.zohoEstimateNumber}, link ${result.shortUrl}, ` +
          `WhatsApp ${result.periskopeSent ? "sent" : `skipped: ${result.periskopeSkipReason}`}, ` +
          `email ${result.emailSent ? "sent" : `not sent: ${result.emailError}`}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[renewalCron] deal ${deal.dealId} (${deal.dealName}) failed: ${message}`);
    }
  }
}
