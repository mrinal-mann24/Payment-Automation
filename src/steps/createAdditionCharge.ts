import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { createEstimate, emailEstimate, findOrCreateCustomer, getEstimatePdf } from "../clients/zoho.js";
import { createPaymentLink } from "../clients/razorpay.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  createAdditionChargeRow,
  findRecentDuplicateAdditionCharge,
  markAdditionChargeDone,
  markAdditionChargeFailed,
  markAdditionEmailError,
  markAdditionEstimateEmailSent,
  markAdditionPeriskopeSent,
  markAdditionPeriskopeSkipped,
} from "../repositories/additionCharges.js";
import { resolveWhatsappRecipient } from "./whatsappRecipient.js";

export interface CreateAdditionChargeResult {
  zohoEstimateNumber: string;
  zohoEstimateTotal: number;
  razorpayShortUrl: string;
  periskopeSent: boolean;
  periskopeSkipReason: string | null;
  emailSent: boolean;
  emailError: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One-time quote ("Send one-time quote" on the admin page): a service name
// and an optional narration, billed separately from the renewal cycle —
// its own Zoho quote + Razorpay link, delivered exactly like a renewal
// quote: to the client's WhatsApp group (contact phone as fallback) and by
// email through Zoho. Delivery is best-effort and recorded per channel on
// the row; the quote and link exist regardless.
export async function createAdditionCharge(
  supabase: SupabaseClient,
  dealId: string,
  amount: number,
  service: string,
  narration: string | null,
): Promise<CreateAdditionChargeResult> {
  const deal = await fetchDealWithLineItemsAndContact(dealId);

  const duplicate = await findRecentDuplicateAdditionCharge(supabase, dealId, amount, service);
  if (duplicate) {
    return {
      zohoEstimateNumber: duplicate.zoho_estimate_number ?? "",
      zohoEstimateTotal: duplicate.zoho_estimate_total ?? 0,
      razorpayShortUrl: duplicate.razorpay_short_url ?? "",
      periskopeSent: duplicate.periskope_sent,
      periskopeSkipReason: duplicate.periskope_skip_reason,
      emailSent: duplicate.estimate_email_sent,
      emailError: duplicate.email_error,
    };
  }

  const row = await createAdditionChargeRow(supabase, dealId, amount, service, narration);

  let estimateId: string;
  let estimateNumber: string;
  let total: number;
  let shortUrl: string;
  try {
    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    ({ estimateId, estimateNumber, total } = await createEstimate(
      customerId,
      { ...deal, lineItems: [{ id: "", name: service, quantity: 1, price: amount }] },
      { key: `one-time-${row.id.slice(0, 8)}`, name: service, description: narration },
    ));

    const link = await createPaymentLink(
      estimateNumber,
      Math.round(total * 100),
      `One-time charge for estimate ${estimateNumber}: ${service}`,
    );
    shortUrl = link.shortUrl;

    await markAdditionChargeDone(supabase, row.id, {
      zohoEstimateId: estimateId,
      zohoEstimateNumber: estimateNumber,
      zohoEstimateTotal: total,
      razorpayPaymentLinkId: link.paymentLinkId,
      razorpayShortUrl: shortUrl,
    });
  } catch (err) {
    await markAdditionChargeFailed(supabase, row.id, errorMessage(err));
    throw err;
  }

  let periskopeSent = false;
  let periskopeSkipReason: string | null = null;
  try {
    const target = await resolveWhatsappRecipient(supabase, dealId, deal.contactPhone);
    if (target.recipient === null) {
      periskopeSkipReason = target.skipReason;
    } else {
      const pdf = await getEstimatePdf(estimateId);
      await sendDocumentMessage(
        target.recipient,
        `Your quote (${estimateNumber}) for ${service} is ready. Pay here: ${shortUrl}`,
        { base64: pdf.toString("base64"), filename: `${estimateNumber}.pdf`, mimetype: "application/pdf" },
      );
      periskopeSent = true;
    }
  } catch (err) {
    periskopeSkipReason = errorMessage(err);
    console.error(`[additionCharge] deal ${dealId} quote ${estimateNumber} WhatsApp send failed: ${periskopeSkipReason}`);
  }
  if (periskopeSent) {
    await markAdditionPeriskopeSent(supabase, row.id);
  } else {
    await markAdditionPeriskopeSkipped(supabase, row.id, periskopeSkipReason ?? "unknown");
  }

  let emailSent = false;
  let emailError: string | null = null;
  try {
    await emailEstimate(estimateId, {
      to: deal.contactEmail,
      subject: `Quote ${estimateNumber} — ${service}`,
      body: [
        `Dear ${deal.contactName || "Client"},`,
        `Please find attached your quote ${estimateNumber} for ${service}${narration ? ` (${narration})` : ""}.`,
        `You can pay online here: ${shortUrl}`,
        "Thank you.",
      ].join("<br><br>"),
    });
    await markAdditionEstimateEmailSent(supabase, row.id);
    emailSent = true;
  } catch (err) {
    emailError = errorMessage(err);
    await markAdditionEmailError(supabase, row.id, `quote email: ${emailError}`);
    console.error(`[additionCharge] deal ${dealId} quote ${estimateNumber} email failed: ${emailError}`);
  }

  return {
    zohoEstimateNumber: estimateNumber,
    zohoEstimateTotal: total,
    razorpayShortUrl: shortUrl,
    periskopeSent,
    periskopeSkipReason,
    emailSent,
    emailError,
  };
}
