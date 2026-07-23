import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { createZohoEstimate } from "../steps/createZohoEstimate.js";
import { createRazorpayLink } from "../steps/createRazorpayLink.js";
import { sendRenewalMessage } from "../steps/sendRenewalMessage.js";
import { updateHubspotDeal } from "../steps/updateHubspotDeal.js";

const renewalWebhookSchema = z.object({
  deal_id: z.string().min(1),
});

export const renewalWebhookRouter = Router();

renewalWebhookRouter.post("/webhooks/renewal", async (req: Request, res: Response) => {
  console.log("[renewalWebhook] received request");

  const parsed = renewalWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log("[renewalWebhook] rejected: invalid payload");
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { deal_id: dealId } = parsed.data;
  console.log(`[renewalWebhook] deal ${dealId} -> creating Zoho estimate`);
  const supabase = getSupabaseClient();

  try {
    const { zohoEstimateId, zohoEstimateNumber, billingPeriod } = await createZohoEstimate(
      supabase,
      dealId,
    );
    console.log(`[renewalWebhook] deal ${dealId} -> estimate ${zohoEstimateNumber} (${zohoEstimateId})`);

    const { paymentLinkId, shortUrl } = await createRazorpayLink(supabase, dealId, billingPeriod);
    console.log(`[renewalWebhook] deal ${dealId} -> payment link ${shortUrl} (${paymentLinkId})`);

    const { sent, skipReason } = await sendRenewalMessage(supabase, dealId, billingPeriod);
    console.log(
      sent
        ? `[renewalWebhook] deal ${dealId} -> WhatsApp quote message sent`
        : `[renewalWebhook] deal ${dealId} -> WhatsApp message skipped: ${skipReason}`,
    );

    await updateHubspotDeal(supabase, dealId, billingPeriod);
    console.log(`[renewalWebhook] deal ${dealId} -> HubSpot updated`);

    res.status(200).json({
      zohoEstimateId,
      zohoEstimateNumber,
      paymentLinkId,
      shortUrl,
      periskopeSent: sent,
      periskopeSkipReason: skipReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[renewalWebhook] deal ${dealId} failed: ${message}`);
    res.status(502).json({ error: "Failed to run renewal pipeline", details: message });
  }
});
