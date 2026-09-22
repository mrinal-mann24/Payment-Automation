import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { verifyWebhookSignature } from "../clients/razorpay.js";
import { findRenewalJobByEstimateNumber } from "../repositories/renewalJobs.js";
import { findAdditionChargeByEstimateNumber } from "../repositories/additionCharges.js";
import { SettlementInProgressError, settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { convertAdditionInvoice } from "../steps/convertAdditionInvoice.js";
import { sendAdditionPaymentConfirmation } from "../steps/sendAdditionPaymentConfirmation.js";
import { sendAdditionInvoiceEmail } from "../steps/sendAdditionInvoiceEmail.js";
import { istToday, unixSecondsToIstDate } from "../utils/billingCycle.js";

const paymentLinkPaidSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({
      entity: z.object({
        reference_id: z.string().min(1),
      }),
    }),
    // Present on real deliveries; optional so an older/simulated payload
    // still settles (amount and reference are then left blank).
    payment: z
      .object({
        entity: z.object({
          id: z.string(),
          amount: z.number(), // paise
          created_at: z.number(), // epoch seconds
        }),
      })
      .optional(),
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
    if (job) {
      const paymentEntity = parsed.data.payload.payment?.entity;
      try {
        const result = await settleRenewalPayment(supabase, job, {
          method: "razorpay",
          amount: paymentEntity ? paymentEntity.amount / 100 : null,
          paymentDate: paymentEntity ? unixSecondsToIstDate(paymentEntity.created_at) : istToday(),
          narration: null,
          reference: paymentEntity?.id ?? null,
        });
        console.log(
          `[razorpayWebhook] deal ${job.hubspot_deal_id} (${job.billing_period}) -> ` +
            `${result.recordedPayment ? "payment recorded" : `already paid via ${result.paidVia}`}, ` +
            `invoice ${result.invoiceNumber ?? "pending"}, WhatsApp ${result.whatsappSent ? "sent" : "not sent"}, ` +
            `email ${result.emailSent ? "sent" : "not sent"}, HubSpot ${result.hubspotDone ? "done" : "pending"}` +
            (result.errors.length ? `; errors: ${result.errors.join("; ")}` : ""),
        );
        // Anything still outstanding -> non-2xx so Razorpay redelivers; the
        // retry is idempotent and only re-runs the unfinished steps.
        res.status(result.errors.length ? 502 : 200).json({ received: true, processed: true, ...result });
      } catch (err) {
        if (err instanceof SettlementInProgressError) {
          console.log(`[razorpayWebhook] deal ${job.hubspot_deal_id} -> settlement already in progress, asking Razorpay to retry`);
          res.status(503).json({ error: "Settlement in progress, retry later" });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[razorpayWebhook] deal ${job.hubspot_deal_id} failed: ${message}`);
        res.status(502).json({ error: "Failed to run payment-confirmation pipeline", details: message });
      }
      return;
    }

    const additionCharge = await findAdditionChargeByEstimateNumber(supabase, estimateNumber);
    if (additionCharge && additionCharge.status === "done") {
      try {
        console.log(`[razorpayWebhook] addition charge ${estimateNumber} -> converting estimate to invoice`);
        const { invoiceId, invoiceNumber } = await convertAdditionInvoice(supabase, estimateNumber);
        console.log(`[razorpayWebhook] addition charge ${estimateNumber} -> invoice ${invoiceNumber} (${invoiceId})`);

        const { sent, skipReason } = await sendAdditionPaymentConfirmation(supabase, estimateNumber);
        console.log(
          sent
            ? `[razorpayWebhook] addition charge ${estimateNumber} -> payment-confirmation WhatsApp message sent`
            : `[razorpayWebhook] addition charge ${estimateNumber} -> payment-confirmation message skipped: ${skipReason}`,
        );

        const email = await sendAdditionInvoiceEmail(supabase, estimateNumber);
        console.log(
          email.sent
            ? `[razorpayWebhook] addition charge ${estimateNumber} -> invoice email sent`
            : `[razorpayWebhook] addition charge ${estimateNumber} -> invoice email not sent: ${email.error}`,
        );

        res.status(200).json({
          received: true,
          processed: true,
          periskopeSent: sent,
          periskopeSkipReason: skipReason,
          emailSent: email.sent,
          emailError: email.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[razorpayWebhook] addition charge ${estimateNumber} failed: ${message}`);
        res.status(502).json({ error: "Failed to run addition-charge payment-confirmation pipeline", details: message });
      }
      return;
    }

    console.log(
      `[razorpayWebhook] ignored: no matching renewal_job or addition_charge in "done" state for estimate ${estimateNumber}`,
    );
    res.status(200).json({ received: true, processed: false });
  },
);
