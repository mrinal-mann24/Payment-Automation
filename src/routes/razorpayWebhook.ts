import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { verifyWebhookSignature } from "../clients/razorpay.js";
import { findRenewalJobByEstimateNumber } from "../repositories/renewalJobs.js";
import { convertZohoInvoice } from "../steps/convertZohoInvoice.js";
import { sendPaymentConfirmation } from "../steps/sendPaymentConfirmation.js";
import { markRenewalDone } from "../steps/markRenewalDone.js";

const paymentLinkPaidSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({
      entity: z.object({
        reference_id: z.string().min(1),
      }),
    }),
  }),
});

export const razorpayWebhookRouter = Router();

razorpayWebhookRouter.post(
  "/webhooks/razorpay",
  async (req: Request & { rawBody?: string }, res: Response) => {
    console.log("[razorpayWebhook] received request");

    const signature = req.header("X-Razorpay-Signature");
    if (!signature || !req.rawBody || !verifyWebhookSignature(req.rawBody, signature)) {
      console.log("[razorpayWebhook] rejected: invalid or missing signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const parsed = paymentLinkPaidSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.event !== "payment_link.paid") {
      console.log(
        `[razorpayWebhook] ignored: not a payment_link.paid event (event=${req.body?.event ?? "unknown"})`,
      );
      res.status(200).json({ received: true, processed: false });
      return;
    }

    const estimateNumber = parsed.data.payload.payment_link.entity.reference_id;
    console.log(`[razorpayWebhook] payment_link.paid for estimate ${estimateNumber}`);
    const supabase = getSupabaseClient();

    const job = await findRenewalJobByEstimateNumber(supabase, estimateNumber);
    if (!job || job.razorpay_step_status !== "done") {
      console.log(
        `[razorpayWebhook] ignored: no matching renewal_job in "done" razorpay state for estimate ${estimateNumber}`,
      );
      res.status(200).json({ received: true, processed: false });
      return;
    }

    try {
      console.log(`[razorpayWebhook] deal ${job.hubspot_deal_id} -> converting estimate to invoice`);
      const { invoiceId, invoiceNumber } = await convertZohoInvoice(
        supabase,
        job.hubspot_deal_id,
        job.billing_period,
      );
      console.log(
        `[razorpayWebhook] deal ${job.hubspot_deal_id} -> invoice ${invoiceNumber} (${invoiceId})`,
      );

      const { sent, skipReason } = await sendPaymentConfirmation(
        supabase,
        job.hubspot_deal_id,
        job.billing_period,
      );
      console.log(
        sent
          ? `[razorpayWebhook] deal ${job.hubspot_deal_id} -> payment-confirmation WhatsApp message sent`
          : `[razorpayWebhook] deal ${job.hubspot_deal_id} -> payment-confirmation message skipped: ${skipReason}`,
      );

      await markRenewalDone(supabase, job.hubspot_deal_id, job.billing_period);
      console.log(`[razorpayWebhook] deal ${job.hubspot_deal_id} -> HubSpot marked Renewal Done`);

      res.status(200).json({ received: true, processed: true, periskopeSent: sent, periskopeSkipReason: skipReason });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[razorpayWebhook] deal ${job.hubspot_deal_id} failed: ${message}`);
      res.status(502).json({ error: "Failed to run payment-confirmation pipeline", details: message });
    }
  },
);
