import type { SupabaseClient } from "@supabase/supabase-js";
import { convertEstimateToInvoice } from "../clients/zoho.js";
import {
  claimInvoiceStep,
  findRenewalJob,
  markInvoiceStepDone,
  markInvoiceStepFailed,
} from "../repositories/renewalJobs.js";

export interface ConvertZohoInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
}

// Razorpay redelivers webhooks, so two payment_link.paid deliveries for the
// same job can arrive close together. Zoho's estimate->invoice conversion
// endpoint is not idempotent (see ARCHITECTURE.md), so this polls briefly
// for the winner of claimInvoiceStep to finish instead of racing it.
const CLAIM_WAIT_ATTEMPTS = 5;
const CLAIM_WAIT_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function convertZohoInvoice(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<ConvertZohoInvoiceResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job || job.razorpay_step_status !== "done") {
    throw new Error(
      `Cannot run invoice step for deal ${dealId} (${billingPeriod}): razorpay_step_status is not "done"`,
    );
  }

  if (job.invoice_step_status === "done" && job.zoho_invoice_id && job.zoho_invoice_number) {
    return { invoiceId: job.zoho_invoice_id, invoiceNumber: job.zoho_invoice_number };
  }

  if (!job.zoho_estimate_id) {
    throw new Error(
      `renewal_jobs row for deal ${dealId} (${billingPeriod}) is missing zoho_estimate_id`,
    );
  }

  if (job.invoice_step_status === "pending") {
    const claimed = await claimInvoiceStep(supabase, job.id);
    if (!claimed) {
      // Another concurrent delivery (e.g. a Razorpay webhook retry) won the
      // race and is converting the estimate right now. Wait for it to
      // finish rather than also calling Zoho's non-idempotent endpoint.
      return waitForInvoiceStepDone(supabase, dealId, billingPeriod);
    }
  } else if (job.invoice_step_status === "converting") {
    return waitForInvoiceStepDone(supabase, dealId, billingPeriod);
  }

  try {
    const { invoiceId, invoiceNumber } = await convertEstimateToInvoice(job.zoho_estimate_id);
    await markInvoiceStepDone(supabase, job.id, invoiceId, invoiceNumber);
    return { invoiceId, invoiceNumber };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markInvoiceStepFailed(supabase, job.id, message);
    throw err;
  }
}

async function waitForInvoiceStepDone(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<ConvertZohoInvoiceResult> {
  for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt++) {
    await sleep(CLAIM_WAIT_DELAY_MS);
    const job = await findRenewalJob(supabase, dealId, billingPeriod);
    if (job?.invoice_step_status === "done" && job.zoho_invoice_id && job.zoho_invoice_number) {
      return { invoiceId: job.zoho_invoice_id, invoiceNumber: job.zoho_invoice_number };
    }
    if (job?.invoice_step_status === "failed") {
      throw new Error(
        `Concurrent invoice conversion for deal ${dealId} (${billingPeriod}) failed; not retrying from the losing side`,
      );
    }
  }

  throw new Error(
    `Timed out waiting for concurrent invoice conversion to finish for deal ${dealId} (${billingPeriod})`,
  );
}
