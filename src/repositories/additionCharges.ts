import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentDetails } from "./renewalJobs.js";

export interface AdditionCharge {
  id: string;
  hubspot_deal_id: string;
  amount: number;
  description: string; // the service name shown as the Zoho line item
  narration: string | null; // optional line under the service name
  zoho_estimate_id: string | null;
  zoho_estimate_number: string | null;
  zoho_estimate_total: number | null;
  razorpay_payment_link_id: string | null;
  razorpay_short_url: string | null;
  status: "pending" | "done" | "failed";
  zoho_invoice_id: string | null;
  zoho_invoice_number: string | null;
  invoice_step_status: "pending" | "done" | "failed";
  periskope_payment_confirmed_sent: boolean;
  periskope_sent: boolean;
  periskope_skip_reason: string | null;
  estimate_email_sent: boolean;
  invoice_email_sent: boolean;
  email_error: string | null;
  error_log: unknown;
  paid_at: string | null; // PAID ⇔ set, whichever way the money came
  payment_method: string | null;
  payment_amount: number | null;
  payment_date: string | null;
  payment_narration: string | null;
  payment_reference: string | null;
  zoho_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function findAdditionChargeById(supabase: SupabaseClient, id: string): Promise<AdditionCharge | null> {
  const { data, error } = await supabase.from("addition_charges").select("*").eq("id", id).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up addition_charges row by id: ${error.message}`);
  }

  return data as AdditionCharge | null;
}

export async function findAdditionChargeByEstimateNumber(
  supabase: SupabaseClient,
  estimateNumber: string,
): Promise<AdditionCharge | null> {
  const { data, error } = await supabase
    .from("addition_charges")
    .select("*")
    .eq("zoho_estimate_number", estimateNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up addition_charges row by estimate number: ${error.message}`);
  }

  return data as AdditionCharge | null;
}

// Guards against a double-submit of the pricing admin's "Send" button (no
// server-side uniqueness exists on this table, unlike renewal_jobs/
// client_pricing) — treats an identical deal+amount+description charge
// created in the last few minutes and not yet failed as the same request,
// rather than creating a second Zoho estimate/Razorpay link/WhatsApp send.
const DUPLICATE_SUBMIT_WINDOW_MS = 5 * 60 * 1000;

export async function findRecentDuplicateAdditionCharge(
  supabase: SupabaseClient,
  dealId: string,
  amount: number,
  description: string,
): Promise<AdditionCharge | null> {
  const since = new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("addition_charges")
    .select("*")
    .eq("hubspot_deal_id", dealId)
    .eq("amount", amount)
    .eq("description", description)
    .neq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up recent addition_charges duplicates: ${error.message}`);
  }

  return data as AdditionCharge | null;
}

export async function createAdditionChargeRow(
  supabase: SupabaseClient,
  dealId: string,
  amount: number,
  description: string,
  narration: string | null,
): Promise<AdditionCharge> {
  const { data, error } = await supabase
    .from("addition_charges")
    .insert({ hubspot_deal_id: dealId, amount, description, narration })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create addition_charges row: ${error.message}`);
  }

  return data as AdditionCharge;
}

export async function markAdditionChargeDone(
  supabase: SupabaseClient,
  id: string,
  fields: {
    zohoEstimateId: string;
    zohoEstimateNumber: string;
    zohoEstimateTotal: number;
    razorpayPaymentLinkId: string;
    razorpayShortUrl: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({
      zoho_estimate_id: fields.zohoEstimateId,
      zoho_estimate_number: fields.zohoEstimateNumber,
      zoho_estimate_total: fields.zohoEstimateTotal,
      razorpay_payment_link_id: fields.razorpayPaymentLinkId,
      razorpay_short_url: fields.razorpayShortUrl,
      status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to mark addition_charges row done: ${error.message}`);
  }
}

export async function markAdditionChargeFailed(
  supabase: SupabaseClient,
  id: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({
      status: "failed",
      error_log: { message: errorMessage, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to mark addition_charges row failed: ${error.message}`);
  }
}

export async function markAdditionInvoiceStepDone(
  supabase: SupabaseClient,
  id: string,
  invoiceId: string,
  invoiceNumber: string,
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({
      zoho_invoice_id: invoiceId,
      zoho_invoice_number: invoiceNumber,
      invoice_step_status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to record addition_charges invoice: ${error.message}`);
  }
}

export async function markAdditionInvoiceStepFailed(
  supabase: SupabaseClient,
  id: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({
      invoice_step_status: "failed",
      error_log: { step: "invoice", message: errorMessage, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to record addition_charges invoice failure: ${error.message}`);
  }
}

export async function markAdditionPaymentConfirmedSent(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({
      periskope_payment_confirmed_sent: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to record addition_charges payment-confirmed send: ${error.message}`);
  }
}

async function updateAdditionCharge(
  supabase: SupabaseClient,
  id: string,
  fields: Record<string, unknown>,
  what: string,
): Promise<void> {
  const { error } = await supabase
    .from("addition_charges")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to record addition_charges ${what}: ${error.message}`);
  }
}

export function markAdditionPeriskopeSent(supabase: SupabaseClient, id: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { periskope_sent: true, periskope_skip_reason: null }, "quote send");
}

export function markAdditionPeriskopeSkipped(supabase: SupabaseClient, id: string, reason: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { periskope_skip_reason: reason }, "quote skip");
}

export function markAdditionEstimateEmailSent(supabase: SupabaseClient, id: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { estimate_email_sent: true, email_error: null }, "quote email");
}

export function markAdditionInvoiceEmailSent(supabase: SupabaseClient, id: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { invoice_email_sent: true, email_error: null }, "invoice email");
}

export function markAdditionEmailError(supabase: SupabaseClient, id: string, message: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { email_error: message }, "email error");
}

// Newest first, for the admin page's one-time quotes table.
export async function listRecentAdditionCharges(supabase: SupabaseClient, limit = 100): Promise<AdditionCharge[]> {
  const { data, error } = await supabase
    .from("addition_charges")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list addition_charges rows: ${error.message}`);
  }

  return (data ?? []) as AdditionCharge[];
}

// First writer wins, exactly like claimPayment on renewal_jobs: a Razorpay
// webhook, an admin click and a duplicate delivery record one payment.
export async function claimAdditionPayment(
  supabase: SupabaseClient,
  id: string,
  payment: PaymentDetails,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("addition_charges")
    .update({
      paid_at: new Date().toISOString(),
      payment_method: payment.method,
      payment_amount: payment.amount,
      payment_date: payment.paymentDate,
      payment_narration: payment.narration,
      payment_reference: payment.reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("paid_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to record payment on addition_charges: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

export function recordAdditionDuplicatePayment(supabase: SupabaseClient, id: string, payment: PaymentDetails): Promise<void> {
  return updateAdditionCharge(
    supabase,
    id,
    {
      error_log: {
        step: "duplicate_payment",
        message: `a second payment (${payment.method}${payment.reference ? ` ${payment.reference}` : ""}, amount ${payment.amount ?? "unknown"}) arrived after this quote was already paid`,
        payment,
        at: new Date().toISOString(),
      },
    },
    "duplicate payment",
  );
}

export function saveAdditionZohoPaymentId(supabase: SupabaseClient, id: string, paymentId: string): Promise<void> {
  return updateAdditionCharge(supabase, id, { zoho_payment_id: paymentId }, "Zoho payment");
}

// Paid one-time quotes with a settlement step still outstanding — the
// daily sweep's retry, like findPaidUnsettledJobs.
export async function findPaidUnsettledAdditionCharges(supabase: SupabaseClient): Promise<AdditionCharge[]> {
  const { data, error } = await supabase
    .from("addition_charges")
    .select("*")
    .not("paid_at", "is", null)
    .or("invoice_step_status.neq.done,zoho_payment_id.is.null,periskope_payment_confirmed_sent.is.false,invoice_email_sent.is.false");

  if (error) {
    throw new Error(`Failed to look up paid-but-unsettled addition_charges rows: ${error.message}`);
  }

  return (data ?? []) as AdditionCharge[];
}
