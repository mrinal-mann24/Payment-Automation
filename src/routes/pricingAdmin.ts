import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { fetchVaDealsWithLineItems } from "../clients/hubspot.js";
import { upsertClientPricing } from "../repositories/clientPricing.js";
import { findAdminCycleJobs, findRenewalJobById, type RenewalJob } from "../repositories/renewalJobs.js";
import { createAdditionCharge } from "../steps/createAdditionCharge.js";
import { SettlementInProgressError, settleRenewalPayment } from "../steps/settleRenewalPayment.js";
import { currentBillingCycle, istToday, servicePeriod } from "../utils/billingCycle.js";
import { deriveCycleStatus } from "../utils/cycleStatus.js";
import { classifyDeal } from "../utils/monthlyEligibility.js";
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
    servicePeriod: job.service_period_start ? servicePeriod(job.billing_period).narration : null,
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

pricingAdminRouter.get("/admin/pricing/deals", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const cycle = currentBillingCycle();
    const [deals, pricing, jobs] = await Promise.all([
      fetchVaDealsWithLineItems(),
      supabase.from("client_pricing").select("*"),
      findAdminCycleJobs(supabase, cycle.key),
    ]);
    if (pricing.error) throw new Error(pricing.error.message);

    const pricingByDealId = new Map(pricing.data?.map((r) => [r.hubspot_deal_id, r]) ?? []);
    const jobsByDealId = new Map<string, RenewalJob[]>();
    for (const job of jobs) {
      jobsByDealId.set(job.hubspot_deal_id, [...(jobsByDealId.get(job.hubspot_deal_id) ?? []), job]);
    }

    const result = deals.map((deal) => {
      const classification = classifyDeal(deal, cycle.period.start);
      return {
        dealId: deal.dealId,
        dealName: deal.dealName,
        dealStage: deal.dealStage,
        basePrice: pricingByDealId.get(deal.dealId)?.base_price ?? null,
        billing: {
          monthly: classification.monthly,
          due: classification.monthly ? classification.due : null,
          reason: "reason" in classification ? classification.reason : null,
        },
        cycles: (jobsByDealId.get(deal.dealId) ?? []).map(cycleView),
      };
    });

    res.status(200).json({
      cycle: { key: cycle.key, narration: cycle.period.narration, today: istToday() },
      deals: result,
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

const sendAdditionSchema = z.object({
  dealId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().min(1),
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
      parsed.data.description,
    );
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to send addition charge", details: message });
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
