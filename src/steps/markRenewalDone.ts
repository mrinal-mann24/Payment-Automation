import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addLineItemToDeal,
  createRenewalLineItem,
  fetchDealWithLineItemsAndContact,
  markDealRenewalDone,
  type HubspotDeal,
} from "../clients/hubspot.js";
import {
  findRenewalJob,
  markHubspotRenewalDone,
  saveHubspotLineItemId,
  type RenewalJob,
} from "../repositories/renewalJobs.js";
import { istToday } from "../utils/billingCycle.js";

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

  if (job.service_period_start) {
    // Billing cycle: exactly one complete Renewal line item per paid cycle,
    // recorded on the row before the stage move so a crash in between can
    // never produce a second one.
    if (!job.hubspot_line_item_id) {
      const lineItemId = await ensureRenewalLineItem(dealId, deal, job);
      await saveHubspotLineItemId(supabase, job.id, lineItemId);
    }
  } else {
    // Legacy cycle: the bare copy of the deal's line item, as before, but
    // priced at what was actually billed.
    const originalLineItem = deal.lineItems[0];
    if (originalLineItem) {
      await addLineItemToDeal(dealId, {
        name: originalLineItem.name,
        quantity: originalLineItem.quantity,
        price: job.billed_price ?? originalLineItem.price,
      });
    }
  }

  await markDealRenewalDone(dealId);
  await markHubspotRenewalDone(supabase, job.id);
}

async function ensureRenewalLineItem(dealId: string, deal: HubspotDeal, job: RenewalJob): Promise<string> {
  const periodStart = job.service_period_start!;

  // The team may already have entered this month's line item by hand, or a
  // previous run may have created it and died before recording the id.
  const existing = deal.lineItems.find(
    (item) => item.billingStartDate === periodStart && item.recurringRevenueType === "Renewal",
  );
  if (existing) {
    return existing.id;
  }

  if (job.billed_price == null) {
    throw new Error(`renewal_jobs row for deal ${dealId} (${job.billing_period}) has no billed_price`);
  }

  // Name and product come from the deal's most recent line item so the new
  // one matches what the team would have entered.
  const latest =
    deal.lineItems
      .filter((item) => item.billingTermEndDate)
      .sort((a, b) => (a.billingTermEndDate! < b.billingTermEndDate! ? 1 : -1))[0] ?? deal.lineItems[0];

  return createRenewalLineItem(dealId, {
    name: latest?.name || "Virtual Accounting",
    price: job.billed_price,
    productId: latest?.productId ?? null,
    billingStartDate: periodStart,
    datePaid: job.payment_date ?? istToday(),
    months: job.term_months ?? 1,
  });
}
