import type { SupabaseClient } from "@supabase/supabase-js";

export type StepStatus = "pending" | "done" | "failed";

export interface RenewalJob {
  id: string;
  hubspot_deal_id: string;
  billing_period: string;
  status: string;
  zoho_estimate_id: string | null;
  zoho_estimate_number: string | null;
  zoho_estimate_total: number | null;
  zoho_step_status: StepStatus;
  razorpay_payment_link_id: string | null;
  razorpay_short_url: string | null;
  razorpay_step_status: StepStatus;
  periskope_sent: boolean;
  periskope_skip_reason: string | null;
  hubspot_updated: boolean;
  zoho_invoice_id: string | null;
  zoho_invoice_number: string | null;
  invoice_step_status: StepStatus;
  periskope_payment_confirmed_sent: boolean;
  hubspot_renewal_done: boolean;
  reminder_1_sent_at: string | null;
  reminder_2_sent_at: string | null;
  reminder_3_sent_at: string | null;
  reminder_skip_reason: string | null;
  error_log: unknown;
  created_at: string;
  updated_at: string;
}

export async function findRenewalJob(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<RenewalJob | null> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .eq("hubspot_deal_id", dealId)
    .eq("billing_period", billingPeriod)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up renewal_jobs row: ${error.message}`);
  }

  return data as RenewalJob | null;
}

export async function findRenewalJobByEstimateNumber(
  supabase: SupabaseClient,
  estimateNumber: string,
): Promise<RenewalJob | null> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .eq("zoho_estimate_number", estimateNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up renewal_jobs row by estimate number: ${error.message}`);
  }

  return data as RenewalJob | null;
}

export async function findOverdueUnpaidJobs(supabase: SupabaseClient): Promise<RenewalJob[]> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .eq("razorpay_step_status", "done")
    .neq("invoice_step_status", "done");

  if (error) {
    throw new Error(`Failed to look up overdue unpaid renewal_jobs rows: ${error.message}`);
  }

  return (data ?? []) as RenewalJob[];
}

export async function createRenewalJob(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<RenewalJob> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .insert({
      hubspot_deal_id: dealId,
      billing_period: billingPeriod,
      status: "in_progress",
      zoho_step_status: "pending",
      razorpay_step_status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create renewal_jobs row: ${error.message}`);
  }

  return data as RenewalJob;
}

export async function markZohoStepDone(
  supabase: SupabaseClient,
  jobId: string,
  zohoEstimateId: string,
  zohoEstimateNumber: string,
  zohoEstimateTotal: number,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      zoho_estimate_id: zohoEstimateId,
      zoho_estimate_number: zohoEstimateNumber,
      zoho_estimate_total: zohoEstimateTotal,
      zoho_step_status: "done",
      status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Zoho estimate on renewal_jobs: ${error.message}`);
  }
}

export async function markZohoStepFailed(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      zoho_step_status: "failed",
      status: "failed",
      error_log: { step: "zoho_estimate", message: errorMessage, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Zoho failure on renewal_jobs: ${error.message}`);
  }
}

export async function markRazorpayStepDone(
  supabase: SupabaseClient,
  jobId: string,
  paymentLinkId: string,
  shortUrl: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      razorpay_payment_link_id: paymentLinkId,
      razorpay_short_url: shortUrl,
      razorpay_step_status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Razorpay payment link on renewal_jobs: ${error.message}`);
  }
}

export async function markRazorpayStepFailed(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      razorpay_step_status: "failed",
      status: "failed",
      error_log: { step: "razorpay_link", message: errorMessage, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Razorpay failure on renewal_jobs: ${error.message}`);
  }
}

export async function markPeriskopeSent(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      periskope_sent: true,
      periskope_skip_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Periskope send on renewal_jobs: ${error.message}`);
  }
}

export async function markPeriskopeSkipped(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      periskope_sent: false,
      periskope_skip_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Periskope skip on renewal_jobs: ${error.message}`);
  }
}

export async function markHubspotUpdated(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      hubspot_updated: true,
      status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record HubSpot update on renewal_jobs: ${error.message}`);
  }
}

export async function markInvoiceStepDone(
  supabase: SupabaseClient,
  jobId: string,
  zohoInvoiceId: string,
  zohoInvoiceNumber: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      zoho_invoice_id: zohoInvoiceId,
      zoho_invoice_number: zohoInvoiceNumber,
      invoice_step_status: "done",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Zoho invoice on renewal_jobs: ${error.message}`);
  }
}

export async function markInvoiceStepFailed(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      invoice_step_status: "failed",
      error_log: { step: "zoho_invoice", message: errorMessage, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record Zoho invoice failure on renewal_jobs: ${error.message}`);
  }
}

export async function markPaymentConfirmedSent(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      periskope_payment_confirmed_sent: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record payment-confirmed send on renewal_jobs: ${error.message}`);
  }
}

export async function markPaymentConfirmedSkipped(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      periskope_payment_confirmed_sent: false,
      error_log: { step: "periskope_payment_confirmed", message: reason, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record payment-confirmed skip on renewal_jobs: ${error.message}`);
  }
}

export async function markHubspotRenewalDone(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      hubspot_renewal_done: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record HubSpot renewal-done update on renewal_jobs: ${error.message}`);
  }
}

export type ReminderStage = 1 | 2 | 3;

const REMINDER_STAGE_COLUMN: Record<ReminderStage, "reminder_1_sent_at" | "reminder_2_sent_at" | "reminder_3_sent_at"> = {
  1: "reminder_1_sent_at",
  2: "reminder_2_sent_at",
  3: "reminder_3_sent_at",
};

export async function markReminderSent(
  supabase: SupabaseClient,
  jobId: string,
  stage: ReminderStage,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      [REMINDER_STAGE_COLUMN[stage]]: new Date().toISOString(),
      reminder_skip_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record reminder ${stage} sent on renewal_jobs: ${error.message}`);
  }
}

export async function markReminderSkipped(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      reminder_skip_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record reminder skip on renewal_jobs: ${error.message}`);
  }
}
