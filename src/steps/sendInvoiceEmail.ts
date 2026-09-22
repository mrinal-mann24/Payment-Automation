import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDealWithLineItemsAndContact } from "../clients/hubspot.js";
import { emailInvoice } from "../clients/zoho.js";
import { findRenewalJob, markEmailError, markInvoiceEmailSent } from "../repositories/renewalJobs.js";
import { servicePeriodFrom } from "../utils/billingCycle.js";
import type { SendEmailResult } from "./sendQuoteEmail.js";

// Best-effort, same contract as sendQuoteEmail: failures are recorded and
// returned, never thrown, and invoice_email_sent stays false for a retry.
export async function sendInvoiceEmail(
  supabase: SupabaseClient,
  dealId: string,
  billingPeriod: string,
): Promise<SendEmailResult> {
  const job = await findRenewalJob(supabase, dealId, billingPeriod);

  if (!job) {
    throw new Error(`Cannot run invoice-email step for deal ${dealId} (${billingPeriod}): no renewal_job found`);
  }

  if (job.invoice_email_sent) {
    return { sent: true, error: null };
  }

  if (job.invoice_step_status !== "done" || !job.zoho_invoice_id || !job.zoho_invoice_number) {
    return { sent: false, error: "invoice email needs the invoice first" };
  }

  try {
    const deal = await fetchDealWithLineItemsAndContact(dealId);
    const period = job.service_period_start ? servicePeriodFrom(job.service_period_start, job.term_months ?? 1).narration : null;

    await emailInvoice(job.zoho_invoice_id, {
      to: deal.billingEmail ?? deal.contactEmail,
      subject: `Payment received — invoice ${job.zoho_invoice_number}`,
      body: [
        `Dear ${deal.contactName || "Client"},`,
        `Thank you, we have received your payment. Your invoice ${job.zoho_invoice_number} for Virtual Accounting${period ? ` (${period})` : ""} is attached.`,
        "Thank you.",
      ].join("<br><br>"),
    });

    await markInvoiceEmailSent(supabase, job.id);
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEmailError(supabase, job.id, `invoice email: ${message}`);
    return { sent: false, error: message };
  }
}
