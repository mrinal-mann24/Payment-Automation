import type { SupabaseClient } from "@supabase/supabase-js";

export type StepStatus = "pending" | "creating" | "done" | "failed";
export type InvoiceStepStatus = "pending" | "converting" | "done" | "failed";

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
  invoice_step_status: InvoiceStepStatus;
  periskope_payment_confirmed_sent: boolean;
  hubspot_renewal_done: boolean;
  reminder_1_sent_at: string | null;
  reminder_2_sent_at: string | null;
  reminder_3_sent_at: string | null;
  reminder_skip_reason: string | null;
  service_period_start: string | null;
  term_months: number | null; // 1 = calendar month, 3 = quarterly, 6 = half-yearly; null = legacy row
  billed_price: number | null;
  paid_at: string | null;
  payment_method: string | null;
  payment_amount: number | null;
  payment_date: string | null;
  payment_narration: string | null;
  payment_reference: string | null;
  hubspot_line_item_id: string | null;
  estimate_email_sent: boolean;
  invoice_email_sent: boolean;
  email_error: string | null;
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

// Monthly cycles of the given month (YYYY-MM) whose quote + link went out
// but which have not been paid — the only rows reminders are ever sent for.
// Legacy (due-date keyed) rows never match a month key, so non-monthly
// customers get no monthly reminders.
export async function findUnpaidMonthlyJobs(supabase: SupabaseClient, monthKey: string): Promise<RenewalJob[]> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .eq("billing_period", monthKey)
    .eq("razorpay_step_status", "done")
    .is("paid_at", null);

  if (error) {
    throw new Error(`Failed to look up unpaid monthly renewal_jobs rows: ${error.message}`);
  }

  return (data ?? []) as RenewalJob[];
}

// A legacy (due-date keyed) cycle for this deal that has a quote out but no
// payment yet. The monthly generator skips such deals so a customer is
// never asked to pay two quotes for overlapping periods.
export async function findOpenLegacyJob(
  supabase: SupabaseClient,
  dealId: string,
): Promise<RenewalJob | null> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .eq("hubspot_deal_id", dealId)
    .is("service_period_start", null)
    .is("paid_at", null)
    .eq("zoho_step_status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up open legacy renewal_jobs row: ${error.message}`);
  }

  return data as RenewalJob | null;
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

// Flips zoho_step_status from "pending" to "creating" right before calling
// Zoho's /estimates endpoint, which has no client-side idempotency key. If
// the process crashes after Zoho creates the estimate but before
// markZohoStepDone writes the resulting ID back, the job is left at
// "creating" rather than silently back at "pending" — so a resume can
// detect this specific gap and warn loudly (a human should check Zoho for
// an orphaned estimate) instead of quietly creating a second one.
export async function claimZohoStep(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .update({
      zoho_step_status: "creating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("zoho_step_status", "pending")
    .select("id");

  if (error) {
    throw new Error(`Failed to claim Zoho estimate step on renewal_jobs: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

export async function markZohoStepDone(
  supabase: SupabaseClient,
  jobId: string,
  zohoEstimateId: string,
  zohoEstimateNumber: string,
  zohoEstimateTotal: number,
  billed: { price: number; servicePeriodStart: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      zoho_estimate_id: zohoEstimateId,
      zoho_estimate_number: zohoEstimateNumber,
      zoho_estimate_total: zohoEstimateTotal,
      billed_price: billed.price,
      service_period_start: billed.servicePeriodStart,
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

// A "converting" claim older than this belongs to a run that died
// mid-conversion and may be taken over.
const STALE_CONVERTING_MS = 2 * 60 * 1000;

// Atomically claims the invoice-conversion step by flipping
// invoice_step_status to "converting", conditioned at the DB level on it
// being claimable. Two concurrent deliveries for the same job will race
// this update; only one can match the filter, so only one caller gets
// claimed:true and is allowed to call Zoho's non-idempotent
// /invoices/fromestimates conversion. The loser gets claimed:false and
// must not proceed. A step left "failed" by an earlier attempt, or
// "converting" by a run that died, is claimable too — safe because
// convertEstimateToInvoice checks the estimate's real Zoho status first.
export async function claimInvoiceStep(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CONVERTING_MS).toISOString();
  const { data, error } = await supabase
    .from("renewal_jobs")
    .update({
      invoice_step_status: "converting",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .or(
      `invoice_step_status.eq.pending,invoice_step_status.eq.failed,and(invoice_step_status.eq.converting,updated_at.lt.${staleBefore})`,
    )
    .select("id");

  if (error) {
    throw new Error(`Failed to claim invoice step on renewal_jobs: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
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

// Atomically claims a reminder stage: the column is stamped only while it
// is still null AND the cycle is still unpaid, so the paid check and the
// duplicate-run guard are one statement evaluated right before the send.
export async function claimReminder(
  supabase: SupabaseClient,
  jobId: string,
  stage: ReminderStage,
): Promise<boolean> {
  const column = REMINDER_STAGE_COLUMN[stage];
  const { data, error } = await supabase
    .from("renewal_jobs")
    .update({
      [column]: new Date().toISOString(),
      reminder_skip_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .is(column, null)
    .is("paid_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to claim reminder ${stage} on renewal_jobs: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

// Undo a claim whose send failed, so the next run retries it.
export async function releaseReminder(
  supabase: SupabaseClient,
  jobId: string,
  stage: ReminderStage,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      [REMINDER_STAGE_COLUMN[stage]]: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to release reminder ${stage} on renewal_jobs: ${error.message}`);
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

// What the admin page shows per deal: every unpaid cycle plus the current
// month's, newest first.
export async function findAdminCycleJobs(supabase: SupabaseClient, currentMonthKey: string): Promise<RenewalJob[]> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .or(`paid_at.is.null,billing_period.eq.${currentMonthKey}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to look up renewal_jobs rows for the admin page: ${error.message}`);
  }

  return (data ?? []) as RenewalJob[];
}

export async function findRenewalJobById(supabase: SupabaseClient, jobId: string): Promise<RenewalJob | null> {
  const { data, error } = await supabase.from("renewal_jobs").select("*").eq("id", jobId).maybeSingle();

  if (error) {
    throw new Error(`Failed to look up renewal_jobs row by id: ${error.message}`);
  }

  return data as RenewalJob | null;
}

export interface PaymentDetails {
  method: string;
  amount: number | null;
  paymentDate: string; // YYYY-MM-DD, IST
  narration: string | null;
  reference: string | null; // e.g. the Razorpay payment id
}

// First writer wins: paid_at is set only while it is still null, so a
// duplicate Razorpay delivery, a double-click, or a Razorpay-vs-manual race
// records exactly one payment. Returns whether this call recorded it.
export async function claimPayment(
  supabase: SupabaseClient,
  jobId: string,
  payment: PaymentDetails,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .update({
      paid_at: new Date().toISOString(),
      payment_method: payment.method,
      payment_amount: payment.amount,
      payment_date: payment.paymentDate,
      payment_narration: payment.narration,
      payment_reference: payment.reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .is("paid_at", null)
    .select("id");

  if (error) {
    throw new Error(`Failed to record payment on renewal_jobs: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

// A real second payment against an already-paid cycle must never be
// silent: keep it in error_log for the team to reconcile.
export async function recordDuplicatePayment(
  supabase: SupabaseClient,
  jobId: string,
  payment: PaymentDetails,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      error_log: {
        step: "duplicate_payment",
        message: `a second payment (${payment.method}${payment.reference ? ` ${payment.reference}` : ""}, amount ${payment.amount ?? "unknown"}) arrived after this cycle was already paid`,
        payment,
        at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record duplicate payment on renewal_jobs: ${error.message}`);
  }
}

export async function saveHubspotLineItemId(
  supabase: SupabaseClient,
  jobId: string,
  lineItemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      hubspot_line_item_id: lineItemId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record HubSpot line item on renewal_jobs: ${error.message}`);
  }
}

// Paid cycles with any settlement step still outstanding. Re-run daily so a
// manual payment (which has no Razorpay retries behind it) never stays
// half-settled after a transient Zoho/Periskope/HubSpot failure.
export async function findPaidUnsettledJobs(supabase: SupabaseClient): Promise<RenewalJob[]> {
  const { data, error } = await supabase
    .from("renewal_jobs")
    .select("*")
    .not("paid_at", "is", null)
    .or(
      "invoice_step_status.neq.done,periskope_payment_confirmed_sent.is.false,invoice_email_sent.is.false,hubspot_renewal_done.is.false",
    );

  if (error) {
    throw new Error(`Failed to look up paid-but-unsettled renewal_jobs rows: ${error.message}`);
  }

  return (data ?? []) as RenewalJob[];
}

export async function markEstimateEmailSent(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      estimate_email_sent: true,
      email_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record quote email on renewal_jobs: ${error.message}`);
  }
}

export async function markInvoiceEmailSent(supabase: SupabaseClient, jobId: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      invoice_email_sent: true,
      email_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record invoice email on renewal_jobs: ${error.message}`);
  }
}

export async function markEmailError(supabase: SupabaseClient, jobId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("renewal_jobs")
    .update({
      email_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to record email error on renewal_jobs: ${error.message}`);
  }
}
