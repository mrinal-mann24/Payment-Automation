import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { asEmail, fetchVaDealEmails, fetchVaDealsWithLineItems, updateDealAccountantEmail, type DealEmails } from "../clients/hubspot.js";
import { generateRenewalQuote, QuoteNotDueError } from "../jobs/generateRenewalQuote.js";
import { listRecentAdditionCharges, type AdditionCharge } from "../repositories/additionCharges.js";
import { upsertClientPricing } from "../repositories/clientPricing.js";
import { findAdminCycleJobs, findRenewalJobById, type RenewalJob } from "../repositories/renewalJobs.js";
import { createAdditionCharge } from "../steps/createAdditionCharge.js";
import { SettlementInProgressError, settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { currentBillingCycle, istToday, servicePeriodFrom } from "../utils/billingCycle.js";
import { deriveCycleStatus } from "../utils/cycleStatus.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";
import { pricingAdminHtml } from "./pricingAdminPage.js";

export const pricingAdminRouter = Router();

pricingAdminRouter.get("/admin/pricing", (_req: Request, res: Response) => {
  res.type("html").send(pricingAdminHtml);
});

function cycleView(job: RenewalJob) {
  const errorLog = job.error_log as { step?: string; message?: string } | null;
  return {
    jobId: job.id,
    billingPeriod: job.billing_period,
    servicePeriod: job.service_period_start
      ? servicePeriodFrom(job.service_period_start, job.term_months ?? 1).narration
      : null,
    status: deriveCycleStatus(job),
    quoteNumber: job.zoho_estimate_number,
    quoteTotal: job.zoho_estimate_total,
    shortUrl: job.razorpay_short_url,
    invoiceNumber: job.zoho_invoice_number,
    paidAt: job.paid_at,
    paymentMethod: job.payment_method,
    paymentAmount: job.payment_amount,
    paymentDate: job.payment_date,
    paymentNarration: job.payment_narration,
    remindersSent: [job.reminder_1_sent_at, job.reminder_2_sent_at, job.reminder_3_sent_at].filter(Boolean).length,
    issue: job.email_error ?? (errorLog?.message ? `${errorLog.step ?? "error"}: ${errorLog.message}` : null),
  };
}

const BILLING_LABELS: Record<DealClassification["kind"], string> = {
  monthly: "Monthly",
  term: "Term",
  unsupported: "Unsupported",
  none: "Not billed",
};

// How the deal is billed and whether the cycle it is due for has a row yet
// — "Quote now" shows when it is due and nothing has been generated.
function billingView(classification: DealClassification, monthKey: string, jobs: RenewalJob[]) {
  const cycleKey =
    classification.kind === "monthly" ? monthKey : classification.kind === "term" ? classification.periodStart : null;
  const label =
    classification.kind === "term"
      ? classification.months === 3
        ? "Quarterly"
        : "Half-yearly"
      : BILLING_LABELS[classification.kind];
  return {
    kind: classification.kind,
    label,
    due: "due" in classification ? classification.due : null,
    reason: "reason" in classification ? classification.reason : null,
    periodStart: classification.kind === "term" ? classification.periodStart : null,
    lastPaid: classification.kind === "term" ? classification.lastPaid : null,
    cycleKey,
    quoted: cycleKey !== null && jobs.some((job) => job.billing_period === cycleKey),
  };
}

// One-time quotes: PAID once the Razorpay webhook has converted the invoice.
function additionView(charge: AdditionCharge, dealNames: Map<string, string>) {
  const errorLog = charge.error_log as { step?: string; message?: string } | null;
  return {
    id: charge.id,
    dealId: charge.hubspot_deal_id,
    dealName: dealNames.get(charge.hubspot_deal_id) ?? charge.hubspot_deal_id,
    service: charge.description,
    narration: charge.narration,
    amount: charge.amount,
    quoteNumber: charge.zoho_estimate_number,
    quoteTotal: charge.zoho_estimate_total,
    shortUrl: charge.razorpay_short_url,
    invoiceNumber: charge.zoho_invoice_number,
    status:
      charge.status === "failed"
        ? "failed"
        : charge.invoice_step_status === "done"
          ? "paid"
          : charge.status === "done"
            ? "payment_pending"
            : "unpaid",
    whatsappSent: charge.periskope_sent,
    whatsappSkipReason: charge.periskope_skip_reason,
    emailSent: charge.estimate_email_sent,
    invoiceEmailSent: charge.invoice_email_sent,
    emailError: charge.email_error,
    issue: errorLog?.message ?? null,
    createdAt: charge.created_at,
  };
}

// Where this deal's quotes and invoices are emailed: the Accountant Email
// when it is a real address, otherwise nowhere (no email is sent).
function emailView(emails: DealEmails | undefined) {
  const accountantEmail = emails?.accountantEmail ?? null;
  const accountantValid = asEmail(accountantEmail) !== null;
  return {
    accountantEmail,
    accountantValid,
    sendsTo: accountantValid ? accountantEmail : null,
  };
}

pricingAdminRouter.get("/admin/pricing/deals", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const cycle = currentBillingCycle();
    const today = istToday();
    const [deals, pricing, jobs, additions] = await Promise.all([
      fetchVaDealsWithLineItems(),
      supabase.from("client_pricing").select("*"),
      findAdminCycleJobs(supabase, cycle.key),
      listRecentAdditionCharges(supabase),
    ]);
    if (pricing.error) throw new Error(pricing.error.message);
    const emails = await fetchVaDealEmails(deals.map((deal) => deal.dealId));

    const pricingByDealId = new Map(pricing.data?.map((r) => [r.hubspot_deal_id, r]) ?? []);
    const jobsByDealId = new Map<string, RenewalJob[]>();
    for (const job of jobs) {
      jobsByDealId.set(job.hubspot_deal_id, [...(jobsByDealId.get(job.hubspot_deal_id) ?? []), job]);
    }

    const result = deals.map((deal) => {
      const dealJobs = jobsByDealId.get(deal.dealId) ?? [];
      return {
        dealId: deal.dealId,
        dealName: deal.dealName,
        dealStage: deal.dealStage,
        basePrice: pricingByDealId.get(deal.dealId)?.base_price ?? null,
        billing: billingView(classifyDeal(deal, today), cycle.key, dealJobs),
        email: emailView(emails.get(deal.dealId)),
        cycles: dealJobs.map(cycleView),
      };
    });

    const dealNames = new Map(deals.map((deal) => [deal.dealId, deal.dealName]));
    res.status(200).json({
      cycle: { key: cycle.key, narration: cycle.period.narration, today },
      deals: result,
      additions: additions.map((charge) => additionView(charge, dealNames)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to load deals", details: message });
  }
});

const savePricingSchema = z.object({
  dealId: z.string().min(1),
  basePrice: z.number().nonnegative(),
  dealName: z.string().optional(),
});

pricingAdminRouter.post("/admin/pricing/base-price", async (req: Request, res: Response) => {
  const parsed = savePricingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    await upsertClientPricing(supabase, parsed.data.dealId, parsed.data.basePrice, parsed.data.dealName);
    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to save base price", details: message });
  }
});

// Accountant Email lives on the HubSpot deal; the page edits it in place.
// Blank clears it (quotes then go to the contact's email again).
const accountantEmailSchema = z.object({
  dealId: z.string().min(1),
  email: z.string().trim().max(200),
});

pricingAdminRouter.post("/admin/pricing/accountant-email", async (req: Request, res: Response) => {
  const parsed = accountantEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const email = parsed.data.email === "" ? null : asEmail(parsed.data.email);
  if (parsed.data.email !== "" && email === null) {
    res.status(400).json({ error: "That is not a valid email address" });
    return;
  }

  try {
    await updateDealAccountantEmail(parsed.data.dealId, email);
    console.log(`[pricingAdmin] deal ${parsed.data.dealId} -> accountant email ${email ? "updated" : "cleared"}`);
    res.status(200).json({ ok: true, email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to update the accountant email in HubSpot", details: message });
  }
});

// "Quote now": the renewal quote the daily tick would generate for this
// deal, without the tick's catch-up window (a term that ended weeks ago is
// quoted from the day it ended). 409 when the deal is not due.
const generateQuoteSchema = z.object({
  dealId: z.string().min(1),
});

pricingAdminRouter.post("/admin/pricing/generate-quote", async (req: Request, res: Response) => {
  const parsed = generateQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { kind, result } = await generateRenewalQuote(supabase, parsed.data.dealId);
    console.log(
      `[pricingAdmin] deal ${parsed.data.dealId} (${kind}) -> quote ${result.zohoEstimateNumber} for ${result.billingPeriod}, ` +
        `WhatsApp ${result.periskopeSent ? "sent" : `skipped: ${result.periskopeSkipReason}`}, ` +
        `email ${result.emailSent ? "sent" : `not sent: ${result.emailError}`}`,
    );
    res.status(200).json({ kind, ...result });
  } catch (err) {
    if (err instanceof QuoteNotDueError) {
      res.status(409).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to generate the quote", details: message });
  }
});

// One-time quote: service name + optional narration, sent to the group and
// by email like a renewal quote.
const sendAdditionSchema = z.object({
  dealId: z.string().min(1),
  amount: z.number().positive(),
  service: z.string().trim().min(1).max(200),
  narration: z.string().trim().max(500).optional(),
});

pricingAdminRouter.post("/admin/pricing/send-addition", async (req: Request, res: Response) => {
  const parsed = sendAdditionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const result = await createAdditionCharge(
      supabase,
      parsed.data.dealId,
      parsed.data.amount,
      parsed.data.service,
      parsed.data.narration || null,
    );
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to send the one-time quote", details: message });
  }
});

// Manual payments — "Paid through Yes Bank" is this with method yes_bank and
// the defaults (quote total, today IST). Razorpay payments only ever come in
// through the webhook, never through here.
const recordPaymentSchema = z.object({
  jobId: z.string().min(1),
  method: z.enum(["yes_bank", "upi", "neft", "cheque", "cash", "other"]),
  amount: z.number().positive().optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  narration: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(100).optional(),
});

pricingAdminRouter.post("/admin/pricing/record-payment", async (req: Request, res: Response) => {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const job = await findRenewalJobById(supabase, parsed.data.jobId);
    if (!job) {
      res.status(404).json({ error: "No billing cycle found for that id" });
      return;
    }
    if (!job.zoho_estimate_id) {
      res.status(409).json({ error: "This cycle has no quote yet; a payment cannot be recorded against it" });
      return;
    }

    const result = await settleRenewalPayment(supabase, job, {
      method: parsed.data.method,
      amount: parsed.data.amount ?? job.zoho_estimate_total,
      paymentDate: parsed.data.paymentDate ?? istToday(),
      narration: parsed.data.narration || null,
      reference: parsed.data.reference || null,
    });
    console.log(
      `[pricingAdmin] deal ${job.hubspot_deal_id} (${job.billing_period}) -> ${parsed.data.method} payment ` +
        `${result.recordedPayment ? "recorded" : `not recorded (already paid via ${result.paidVia})`}` +
        (result.errors.length ? `; outstanding: ${result.errors.join("; ")}` : ""),
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof SettlementInProgressError) {
      res.status(409).json({ error: "A payment for this cycle is already being processed; refresh and try again" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to record payment", details: message });
  }
});
