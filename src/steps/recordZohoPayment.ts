import type { SupabaseClient } from "@supabase/supabase-js";
import { recordInvoicePayment, type ZohoPaymentInput } from "../clients/zoho.js";
import { findAdditionChargeByEstimateNumber, saveAdditionZohoPaymentId } from "../repositories/additionCharges.js";
import { findRenewalJob, saveZohoPaymentId } from "../repositories/renewalJobs.js";
import { istToday } from "../utils/billingCycle.js";

// Zoho Books' built-in payment modes; anything else is "others" with the
// method named in the description.
const ZOHO_PAYMENT_MODES: Record<string, string> = {
  yes_bank: "banktransfer",
  neft: "banktransfer",
  cheque: "check",
  cash: "cash",
};

const METHOD_LABELS: Record<string, string> = {
  razorpay: "Razorpay",
  yes_bank: "Yes Bank",
  neft: "NEFT",
  upi: "UPI",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

interface PaidRow {
  payment_method: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  payment_narration: string | null;
}

function zohoPaymentFor(row: PaidRow): ZohoPaymentInput {
  const method = row.payment_method ?? "other";
  const label = METHOD_LABELS[method] ?? method;
  return {
    mode: ZOHO_PAYMENT_MODES[method] ?? "others",
    date: row.payment_date ?? istToday(),
    reference: row.payment_reference,
    description: `Paid via ${label}${row.payment_narration ? `: ${row.payment_narration}` : ""}`,
  };
}

// Records the settled payment against the cycle's Zoho invoice so Zoho
// shows it as Paid (and never chases a client who has paid). Runs once the
// invoice exists; the stored payment id makes it run exactly once.
export async function recordZohoPayment(supabase: SupabaseClient, dealId: string, billingPeriod: string): Promise<string> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.invoice_step_status !== "done" || !job.zoho_invoice_id) {
    throw new Error(`Cannot record the Zoho payment for deal ${dealId} (${billingPeriod}): the invoice does not exist yet`);
  }

  if (job.zoho_payment_id) {
    return job.zoho_payment_id;
  }

  const { paymentId } = await recordInvoicePayment(job.zoho_invoice_id, zohoPaymentFor(job));
  await saveZohoPaymentId(supabase, job.id, paymentId);
  return paymentId;
}

// The same for a one-time quote.
export async function recordAdditionZohoPayment(supabase: SupabaseClient, estimateNumber: string): Promise<string> {
  const charge = await findAdditionChargeByEstimateNumber(supabase, estimateNumber);

  if (!charge || charge.invoice_step_status !== "done" || !charge.zoho_invoice_id) {
    throw new Error(`Cannot record the Zoho payment for one-time quote ${estimateNumber}: the invoice does not exist yet`);
  }

  if (charge.zoho_payment_id) {
    return charge.zoho_payment_id;
  }

  const { paymentId } = await recordInvoicePayment(charge.zoho_invoice_id, zohoPaymentFor(charge));
  await saveAdditionZohoPaymentId(supabase, charge.id, paymentId);
  return paymentId;
}
