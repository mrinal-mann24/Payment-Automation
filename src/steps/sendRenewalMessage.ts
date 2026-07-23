import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getEstimatePdf } from "../clients/zoho.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  findRenewalJob,
  markPeriskopeSent,
  markPeriskopeSkipped,
} from "../repositories/renewalJobs.js";

export interface SendRenewalMessageResult {
  sent: boolean;
  skipReason: string | null;
}

export async function sendRenewalMessage(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<SendRenewalMessageResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.razorpay_step_status !== "done") {
    throw new Error(
      `Cannot run Periskope step for deal ${dealId} (${billingPeriod}): razorpay_step_status is not "done"`,
    );
  }

  if (job.periskope_sent) {
    return { sent: true, skipReason: null };
  }
  if (job.periskope_skip_reason) {
    return { sent: false, skipReason: job.periskope_skip_reason };
  }

  if (!job.zoho_estimate_id || !job.zoho_estimate_number || !job.razorpay_short_url) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing zoho_estimate_id, zoho_estimate_number, or razorpay_short_url`,
    );
  }

  const deal = await fetchDealWithLineItemsAndContact(dealId);

  if (!deal.contactPhone) {
    const reason = `No WhatsApp identifier (contact phone) found for deal ${dealId}`;
    await markPeriskopeSkipped(supabase, job.id, reason);
    return { sent: false, skipReason: reason };
  }

  const pdf = await getEstimatePdf(job.zoho_estimate_id);
  const message = `Your renewal quote (${job.zoho_estimate_number}) is ready. Pay here: ${job.razorpay_short_url}`;

  await sendDocumentMessage(deal.contactPhone, message, {
    base64: pdf.toString("base64"),
    filename: `${job.zoho_estimate_number}.pdf`,
    mimetype: "application/pdf",
  });

  await markPeriskopeSent(supabase, job.id);
  return { sent: true, skipReason: null };
}
