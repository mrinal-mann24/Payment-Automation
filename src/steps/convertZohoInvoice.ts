import type { SupabaseClient } from "@supabase/supabase-js";
import { convertEstimateToInvoice } from "../clients/zoho.js";
import {
  findRenewalJob,
  markInvoiceStepDone,
  markInvoiceStepFailed,
} from "../repositories/renewalJobs.js";

export interface ConvertZohoInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
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
