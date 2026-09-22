import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { emailInvoice } from "../clients/zoho.js";
import {
  findAdditionChargeByEstimateNumber,
  markAdditionEmailError,
  markAdditionInvoiceEmailSent,
} from "../repositories/additionCharges.js";
import type { SendEmailResult } from "./sendQuoteEmail.js";

// Best-effort, same contract as sendInvoiceEmail for renewals: failures
// are recorded on the addition_charges row and returned, never thrown.
export async function sendAdditionInvoiceEmail(
  supabase: SupabaseClient,
  estimateNumber: string,
): Promise<SendEmailResult> {
  const charge = await findAdditionChargeByEstimateNumber(supabase, estimateNumber);

  if (!charge) {
    throw new Error(`Cannot run invoice-email step for addition charge estimate ${estimateNumber}: no row found`);
  }

  if (charge.invoice_email_sent) {
    return { sent: true, error: null };
  }

  if (charge.invoice_step_status !== "done" || !charge.zoho_invoice_id || !charge.zoho_invoice_number) {
    return { sent: false, error: "invoice email needs the invoice first" };
  }

  try {
    const deal = await fetchDealWithLineItemsAndContact(charge.hubspot_deal_id);
    if (!deal.billingEmails?.length) {
      await markAdditionEmailError(supabase, charge.id, `invoice email: no Accountant Email on the HubSpot deal`);
      return { sent: false, error: "no Accountant Email on the HubSpot deal" };
    }

    await emailInvoice(charge.zoho_invoice_id, {
      to: deal.billingEmails,
      subject: `Payment received — invoice ${charge.zoho_invoice_number}`,
      body: [
        `Dear ${deal.contactName || "Client"},`,
        `Thank you, we have received your payment. Your invoice ${charge.zoho_invoice_number} for ${charge.description}${charge.narration ? ` (${charge.narration})` : ""} is attached.`,
        "Thank you.",
      ].join("<br><br>"),
    });

    await markAdditionInvoiceEmailSent(supabase, charge.id);
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markAdditionEmailError(supabase, charge.id, `invoice email: ${message}`);
    return { sent: false, error: message };
  }
}
