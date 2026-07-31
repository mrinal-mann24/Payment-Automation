import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { createEstimate, findOrCreateCustomer, getEstimatePdf } from "../clients/zoho.js";
import { createPaymentLink } from "../clients/razorpay.js";
import { sendDocumentMessage } from "../clients/periskope.js";
import {
  createAdditionChargeRow,
  markAdditionChargeDone,
  markAdditionChargeFailed,
} from "../repositories/additionCharges.js";

export interface CreateAdditionChargeResult {
  zohoEstimateNumber: string;
  zohoEstimateTotal: number;
  razorpayShortUrl: string;
  periskopeSent: boolean;
  periskopeSkipReason: string | null;
}

// One-off charge (e.g. a monthly site visit) billed separately from the
// renewal cycle — its own Zoho quote + Razorpay link + WhatsApp send, never
// folded into the renewal total. See ARCHITECTURE.md.
export async function createAdditionCharge(
  supabase: SupabaseClient,
  dealId: string,
  amount: number,
  description: string,
): Promise<CreateAdditionChargeResult> {
  const deal = await fetchDealWithLineItemsAndContact(dealId);
  const row = await createAdditionChargeRow(supabase, dealId, amount, description);

  try {
    const dealForEstimate = {
      ...deal,
      lineItems: [{ id: "", name: description, quantity: 1, price: amount }],
    };

    const customerId = await findOrCreateCustomer(deal.contactEmail, deal.contactName);
    const { estimateId, estimateNumber, total } = await createEstimate(customerId, dealForEstimate);

    const { paymentLinkId, shortUrl } = await createPaymentLink(
      estimateNumber,
      Math.round(total * 100),
      `Additional charge for estimate ${estimateNumber}: ${description}`,
    );

    await markAdditionChargeDone(supabase, row.id, {
      zohoEstimateId: estimateId,
      zohoEstimateNumber: estimateNumber,
      zohoEstimateTotal: total,
      razorpayPaymentLinkId: paymentLinkId,
      razorpayShortUrl: shortUrl,
    });

    let periskopeSent = false;
    let periskopeSkipReason: string | null = null;
    if (!deal.contactPhone) {
      periskopeSkipReason = `No WhatsApp identifier (contact phone) found for deal ${dealId}`;
    } else {
      const pdf = await getEstimatePdf(estimateId);
      const message = `Additional charge (${description}): ${estimateNumber}. Pay here: ${shortUrl}`;
      await sendDocumentMessage(deal.contactPhone, message, {
        base64: pdf.toString("base64"),
        filename: `${estimateNumber}.pdf`,
        mimetype: "application/pdf",
      });
      periskopeSent = true;
    }

    return {
      zohoEstimateNumber: estimateNumber,
      zohoEstimateTotal: total,
      razorpayShortUrl: shortUrl,
      periskopeSent,
      periskopeSkipReason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markAdditionChargeFailed(supabase, row.id, message);
    throw err;
  }
}
