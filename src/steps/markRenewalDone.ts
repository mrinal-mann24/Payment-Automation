import type { SupabaseClient } from "@supabase/supabase-js";
import { addLineItemToDeal, fetchDealWithLineItemsAndContact, markDealRenewalDone } from "../clients/hubspot.js";
import { findRenewalJob, markHubspotRenewalDone } from "../repositories/renewalJobs.js";

export async function markRenewalDone(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<void> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.invoice_step_status !== "done") {
    throw new Error(
      `Cannot run HubSpot renewal-done step for deal ${dealId} (${billingPeriod}): invoice_step_status is not "done"`,
    );
  }

  if (job.hubspot_renewal_done) {
    return;
  }

  const deal = await fetchDealWithLineItemsAndContact(dealId);
  const originalLineItem = deal.lineItems[0];
  if (originalLineItem) {
    await addLineItemToDeal(dealId, {
      name: originalLineItem.name,
      quantity: originalLineItem.quantity,
      price: originalLineItem.price,
    });
  }

  await markDealRenewalDone(dealId);
  await markHubspotRenewalDone(supabase, job.id);
}
