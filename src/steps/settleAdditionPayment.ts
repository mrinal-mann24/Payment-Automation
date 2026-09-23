import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimAdditionPayment,
  findAdditionChargeById,
  recordAdditionDuplicatePayment,
  type AdditionCharge,
} from "../repositories/additionCharges.js";
import { convertAdditionInvoice } from "./convertAdditionInvoice.js";
import { recordAdditionZohoPayment } from "./recordZohoPayment.js";
import { sendAdditionInvoiceEmail } from "./sendAdditionInvoiceEmail.js";
import { sendAdditionPaymentConfirmation } from "./sendAdditionPaymentConfirmation.js";
import { cancelLinkBestEffort, SettlementInProgressError, type PaymentInput } from "./settleRenewalPayment.js";

export interface SettleAdditionPaymentResult {
  chargeId: string;
  estimateNumber: string;
  recordedPayment: boolean;
  alreadyPaid: boolean;
  paidVia: string | null;
  invoiceNumber: string | null;
  zohoPaymentRecorded: boolean;
  whatsappSent: boolean;
  whatsappSkipReason: string | null;
  emailSent: boolean;
  emailError: string | null;
  errors: string[];
}

const inFlight = new Set<string>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// One settlement path for every way a one-time quote gets paid — the
// Razorpay webhook, "Mark paid by Yes Bank" / "Mark paid by Razorpay" / a
// manual entry on the admin page, and the daily sweep (payment = null).
// Mirrors settleRenewalPayment minus the HubSpot step: a one-time quote
// has no cycle to move forward.
export async function settleAdditionPayment(
  supabase: SupabaseClient,
  charge: AdditionCharge,
  payment: PaymentInput | null,
): Promise<SettleAdditionPaymentResult> {
  if (inFlight.has(charge.id)) {
    throw new SettlementInProgressError(`Settlement already in progress for one-time quote ${charge.id}`);
  }
  inFlight.add(charge.id);

  try {
    if (charge.status !== "done" || !charge.zoho_estimate_id || !charge.zoho_estimate_number) {
      throw new Error(
        `Cannot record a payment for one-time quote ${charge.id} (deal ${charge.hubspot_deal_id}): no quote was sent`,
      );
    }
    const estimateNumber = charge.zoho_estimate_number;
    const what = `one-time quote ${estimateNumber} (deal ${charge.hubspot_deal_id})`;

    let recordedPayment = false;
    let alreadyPaid = charge.paid_at !== null;
    let paidVia = charge.payment_method;

    if (payment) {
      recordedPayment = await claimAdditionPayment(supabase, charge.id, payment);
      if (recordedPayment) {
        alreadyPaid = false;
        paidVia = payment.method;
        if (payment.method !== "razorpay" && charge.razorpay_payment_link_id) {
          await cancelLinkBestEffort(charge.razorpay_payment_link_id, what, payment.method);
        }
      } else {
        const current = (await findAdditionChargeById(supabase, charge.id)) ?? charge;
        alreadyPaid = true;
        paidVia = current.payment_method;
        const sameMethod = current.payment_method === payment.method;
        const sameReference =
          !payment.reference || !current.payment_reference || payment.reference === current.payment_reference;
        if (!(sameMethod && sameReference)) {
          console.error(
            `[settle] ${what} received a second payment (${payment.method}${payment.reference ? ` ${payment.reference}` : ""}) after being paid via ${current.payment_method}`,
          );
          await recordAdditionDuplicatePayment(supabase, charge.id, payment);
        }
      }
    }

    const errors: string[] = [];
    let invoiceNumber: string | null = null;
    let zohoPaymentRecorded = false;
    let whatsapp: { sent: boolean; skipReason: string | null } = { sent: false, skipReason: null };
    let email: { sent: boolean; error: string | null } = { sent: false, error: null };

    try {
      invoiceNumber = (await convertAdditionInvoice(supabase, estimateNumber)).invoiceNumber;
    } catch (err) {
      errors.push(`invoice: ${errorMessage(err)}`);
    }

    if (invoiceNumber) {
      try {
        await recordAdditionZohoPayment(supabase, estimateNumber);
        zohoPaymentRecorded = true;
      } catch (err) {
        errors.push(`zoho payment: ${errorMessage(err)}`);
      }
      try {
        whatsapp = await sendAdditionPaymentConfirmation(supabase, estimateNumber);
      } catch (err) {
        errors.push(`whatsapp: ${errorMessage(err)}`);
      }
      try {
        email = await sendAdditionInvoiceEmail(supabase, estimateNumber);
      } catch (err) {
        errors.push(`email: ${errorMessage(err)}`);
      }
    }

    return {
      chargeId: charge.id,
      estimateNumber,
      recordedPayment,
      alreadyPaid,
      paidVia,
      invoiceNumber,
      zohoPaymentRecorded,
      whatsappSent: whatsapp.sent,
      whatsappSkipReason: whatsapp.skipReason,
      emailSent: email.sent,
      emailError: email.error,
      errors,
    };
  } finally {
    inFlight.delete(charge.id);
  }
}
