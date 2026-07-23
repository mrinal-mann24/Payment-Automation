import { getSupabaseClient } from "../clients/supabase.js";
import { findDealsWithRenewalDueToday } from "../clients/neon.js";
import { fetchDealStage, VA_ACTIVE_CUSTOMER_DEALSTAGES } from "../clients/hubspot.js";
import { createZohoEstimate } from "../steps/createZohoEstimate.js";
import { createRazorpayLink } from "../steps/createRazorpayLink.js";
import { sendRenewalMessage } from "../steps/sendRenewalMessage.js";
import { updateHubspotDeal } from "../steps/updateHubspotDeal.js";

export async function runRenewalCheck(): Promise<void> {
  const dueDeals = await findDealsWithRenewalDueToday();
  console.log(`[renewalCron] ${dueDeals.length} deal(s) due for renewal today`);

  const supabase = getSupabaseClient();

  for (const deal of dueDeals) {
    try {
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

      const { zohoEstimateId, zohoEstimateNumber, billingPeriod } = await createZohoEstimate(
        supabase,
        deal.dealId,
      );
      console.log(
        `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> estimate ${zohoEstimateNumber} (${zohoEstimateId})`,
      );

      const { paymentLinkId, shortUrl } = await createRazorpayLink(
        supabase,
        deal.dealId,
        billingPeriod,
      );
      console.log(
        `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> payment link ${shortUrl} (${paymentLinkId})`,
      );

      const { sent, skipReason } = await sendRenewalMessage(supabase, deal.dealId, billingPeriod);
      console.log(
        sent
          ? `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> Periskope message sent`
          : `[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> Periskope message skipped: ${skipReason}`,
      );

      await updateHubspotDeal(supabase, deal.dealId, billingPeriod);
      console.log(`[renewalCron] deal ${deal.dealId} (${deal.dealName}) -> HubSpot updated`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[renewalCron] deal ${deal.dealId} (${deal.dealName}) failed: ${message}`);
    }
  }
}
