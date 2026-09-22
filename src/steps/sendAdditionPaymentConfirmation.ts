import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { getInvoicePdf } from "../clients/zoho.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  findAdditionChargeByEstimateNumber,
  markAdditionPaymentConfirmedSent,
} from "../repositories/additionCharges.js";
import { resolveWhatsappRecipient } from "./whatsappRecipient.js";

export interface SendAdditionPaymentConfirmationResult {
  sent: boolean;
  skipReason: string | null;
}

export async function sendAdditionPaymentConfirmation(
  supabase: SupabaseClient,
  estimateNumber: string,
): Promise<SendAdditionPaymentConfirmationResult> {
  const charge = await findAdditionChargeByEstimateNumber(supabase, estimateNumber);

  if (!charge || charge.invoice_step_status !== "done") {
    throw new Error(
      `Cannot run payment-confirmation step for addition charge estimate ${estimateNumber}: invoice_step_status is not "done"`,
    );
  }

  if (charge.periskope_payment_confirmed_sent) {
    return { sent: true, skipReason: null };
  }

  if (!charge.zoho_invoice_id || !charge.zoho_invoice_number) {
    throw new Error(
      `addition_charges row for estimate ${estimateNumber} is missing zoho_invoice_id or zoho_invoice_number`,
    );
  }

  const deal = await fetchDealWithLineItemsAndContact(charge.hubspot_deal_id);

  // Same recipient rule as renewals: the client's WhatsApp group, contact
  // phone as fallback.
  const target = await resolveWhatsappRecipient(supabase, charge.hubspot_deal_id, deal.contactPhone);
  if (target.recipient === null) {
    return { sent: false, skipReason: target.skipReason };
  }

  const pdf = await getInvoicePdf(charge.zoho_invoice_id);
  const message = `Payment received, thank you! Your invoice (${charge.zoho_invoice_number}) for "${charge.description}" has been generated.`;

  await sendDocumentMessage(target.recipient, message, {
    base64: pdf.toString("base64"),
    filename: `${charge.zoho_invoice_number}.pdf`,
    mimetype: "application/pdf",
  });

  await markAdditionPaymentConfirmedSent(supabase, charge.id);
  return { sent: true, skipReason: null };
}
