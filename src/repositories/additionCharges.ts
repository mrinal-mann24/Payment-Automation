import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdditionCharge {
  id: string;
  hubspot_deal_id: string;
  amount: number;
  description: string;
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
  error_log: unknown;
  created_at: string;
  updated_at: string;
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

export async function createAdditionChargeRow(
  supabase: SupabaseClient,
  dealId: string,
  amount: number,
  description: string,
): Promise<AdditionCharge> {
  const { data, error } = await supabase
    .from("addition_charges")
    .insert({ hubspot_deal_id: dealId, amount, description })
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
