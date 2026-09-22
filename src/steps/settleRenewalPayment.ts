import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelPaymentLink } from "../clients/razorpay.js";
import {
  claimPayment,
  findRenewalJob,
  recordDuplicatePayment,
  type PaymentDetails,
  type RenewalJob,
} from "../repositories/renewalJobs.js";
import { convertZohoInvoice } from "./convertZohoInvoice.js";
import { sendPaymentConfirmation } from "./sendPaymentConfirmation.js";
import { sendInvoiceEmail } from "./sendInvoiceEmail.js";
import { markRenewalDone } from "./markRenewalDone.js";

export const PAYMENT_METHODS = ["razorpay", "yes_bank", "upi", "neft", "cheque", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentInput extends PaymentDetails {
  method: PaymentMethod;
}

export interface SettleRenewalPaymentResult {
  jobId: string;
  billingPeriod: string;
  recordedPayment: boolean;
  alreadyPaid: boolean;
  paidVia: string | null;
  invoiceNumber: string | null;
  whatsappSent: boolean;
  whatsappSkipReason: string | null;
  emailSent: boolean;
  emailError: string | null;
  hubspotDone: boolean;
  errors: string[];
}

export class SettlementInProgressError extends Error {}

// This service is a single process (agent.md), so an in-memory set is
// enough to stop two overlapping settlements of one cycle (a webhook retry
// plus an admin click) from both running the check-then-act confirmation
// steps and sending the client two messages.
const inFlight = new Set<string>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One settlement path for every way a cycle gets paid: the Razorpay
// webhook, "Paid through Yes Bank", a manual entry, and the daily sweep
// (payment = null). Recording the payment comes first, so a later
// Zoho/HubSpot failure can never leave a paid customer looking unpaid (and
// being reminded). The remaining steps are each idempotent and independent,
// so whatever failed is retried by the next call; `errors` lists what is
// still outstanding.
export async function settleRenewalPayment(
  supabase: SupabaseClient,
  job: RenewalJob,
  payment: PaymentInput | null,
): Promise<SettleRenewalPaymentResult> {
  if (inFlight.has(job.id)) {
    throw new SettlementInProgressError(`Settlement already in progress for renewal job ${job.id}`);
  }
  inFlight.add(job.id);

  try {
    if (!job.zoho_estimate_id) {
      throw new Error(
        `Cannot record a payment for deal ${job.hubspot_deal_id} (${job.billing_period}): no quote exists for this cycle`,
      );
    }
    const dealId = job.hubspot_deal_id;
    const billingPeriod = job.billing_period;

    let recordedPayment = false;
    let alreadyPaid = job.paid_at !== null;
    let paidVia = job.payment_method;

    if (payment) {
      recordedPayment = await claimPayment(supabase, job.id, payment);
      if (recordedPayment) {
        alreadyPaid = false;
        paidVia = payment.method;
        // Paid outside Razorpay: close the link straight away so the client
        // cannot pay twice, before anything slower can fail.
        if (payment.method !== "razorpay" && job.razorpay_payment_link_id) {
          await cancelLinkBestEffort(job.razorpay_payment_link_id, dealId, billingPeriod, payment.method);
        }
      } else {
        const current = (await findRenewalJob(supabase, dealId, billingPeriod)) ?? job;
        alreadyPaid = true;
        paidVia = current.payment_method;
        const sameMethod = current.payment_method === payment.method;
        const sameReference =
          !payment.reference || !current.payment_reference || payment.reference === current.payment_reference;
        if (!(sameMethod && sameReference)) {
          console.error(
            `[settle] deal ${dealId} (${billingPeriod}) received a second payment (${payment.method}${payment.reference ? ` ${payment.reference}` : ""}) after being paid via ${current.payment_method}`,
          );
          await recordDuplicatePayment(supabase, job.id, payment);
        }
      }
    }

    const errors: string[] = [];
    let invoiceNumber: string | null = null;
    let whatsapp: { sent: boolean; skipReason: string | null } = { sent: false, skipReason: null };
    let email: { sent: boolean; error: string | null } = { sent: false, error: null };
    let hubspotDone = false;

    try {
      invoiceNumber = (await convertZohoInvoice(supabase, dealId, billingPeriod)).invoiceNumber;
    } catch (err) {
      errors.push(`invoice: ${errorMessage(err)}`);
    }

    if (invoiceNumber) {
      try {
        whatsapp = await sendPaymentConfirmation(supabase, dealId, billingPeriod);
      } catch (err) {
        errors.push(`whatsapp: ${errorMessage(err)}`);
      }
      try {
        email = await sendInvoiceEmail(supabase, dealId, billingPeriod);
      } catch (err) {
        errors.push(`email: ${errorMessage(err)}`);
      }
      try {
        await markRenewalDone(supabase, dealId, billingPeriod);
        hubspotDone = true;
      } catch (err) {
        errors.push(`hubspot: ${errorMessage(err)}`);
      }
    }

    return {
      jobId: job.id,
      billingPeriod,
      recordedPayment,
      alreadyPaid,
      paidVia,
      invoiceNumber,
      whatsappSent: whatsapp.sent,
      whatsappSkipReason: whatsapp.skipReason,
      emailSent: email.sent,
      emailError: email.error,
      hubspotDone,
      errors,
    };
  } finally {
    inFlight.delete(job.id);
  }
}

async function cancelLinkBestEffort(
  paymentLinkId: string,
  dealId: string,
  billingPeriod: string,
  method: string,
): Promise<void> {
  try {
    const outcome = await cancelPaymentLink(paymentLinkId);
    if (outcome === "already_paid") {
      console.error(
        `[settle] deal ${dealId} (${billingPeriod}): Razorpay link ${paymentLinkId} was ALREADY PAID before this ${method} payment was recorded — check for a double payment`,
      );
    }
  } catch (err) {
    console.error(
      `[settle] deal ${dealId} (${billingPeriod}): could not cancel Razorpay link ${paymentLinkId}: ${errorMessage(err)}`,
    );
  }
}
