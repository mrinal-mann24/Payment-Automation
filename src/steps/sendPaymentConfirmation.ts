import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getInvoicePdf } from "../clients/zoho.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  findRenewalJob,
  markPaymentConfirmedSent,
  markPaymentConfirmedSkipped,
} from "../repositories/renewalJobs.js";
import { resolveWhatsappRecipient } from "./whatsappRecipient.js";

export interface SendPaymentConfirmationResult {
  sent: boolean;
  skipReason: string | null;
}

export async function sendPaymentConfirmation(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<SendPaymentConfirmationResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.invoice_step_status !== "done") {
    throw new Error(
      `Cannot run payment-confirmation step for deal ${dealId} (${billingPeriod}): invoice_step_status is not "done"`,
    );
  }

  if (job.periskope_payment_confirmed_sent) {
    return { sent: true, skipReason: null };
  }

  if (!job.zoho_invoice_id || !job.zoho_invoice_number) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing zoho_invoice_id or zoho_invoice_number`,
    );
  }

  const deal = await fetchDealWithLineItemsAndContact(dealId);

  const target = await resolveWhatsappRecipient(supabase, dealId, deal.contactPhone);
  if (target.recipient === null) {
    await markPaymentConfirmedSkipped(supabase, job.id, target.skipReason);
    return { sent: false, skipReason: target.skipReason };
  }

  const pdf = await getInvoicePdf(job.zoho_invoice_id);
  const message = `Payment received, thank you! Your invoice (${job.zoho_invoice_number}) has been generated.`;

  await sendDocumentMessage(target.recipient, message, {
    base64: pdf.toString("base64"),
    filename: `${job.zoho_invoice_number}.pdf`,
    mimetype: "application/pdf",
  });

  await markPaymentConfirmedSent(supabase, job.id);
  return { sent: true, skipReason: null };
}
