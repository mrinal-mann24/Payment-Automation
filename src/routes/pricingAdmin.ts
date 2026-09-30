import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import {
  asEmail,
  fetchVaDealEmails,
  fetchVaDealsWithLineItems,
  parseEmailList,
  updateDealAccountantEmails,
  type DealEmails,
} from "../clients/hubspot.js";
import { isValidWhatsappGroupId } from "../clients/periskope.js";
import { fetchPaymentLink } from "../clients/razorpay.js";
import {
  findAdditionChargeById,
  findPaidUnsettledAdditionCharges,
  listRecentAdditionCharges,
  type AdditionCharge,
} from "../repositories/additionCharges.js";
import { setAutoQuote, setClientName, setPendingSinceOverride, upsertClientPricing } from "../repositories/clientPricing.js";
import { setWhatsappGroupId } from "../repositories/clients.js";
import { findAdminCycleJobs, findRenewalJobById, type RenewalJob } from "../repositories/renewalJobs.js";
import { createAdditionCharge } from "../steps/createAdditionCharge.js";
import { settleAdditionPayment } from "../steps/settleAdditionPayment.js";
import {
  PAYMENT_METHODS,
  SettlementInProgressError,
  settleRenewalPayment,
  type PaymentInput,
} from "../steps/settleRenewalPayment.js";
import { billingMonthKey, daysBetween, istToday, monthsPendingSince, servicePeriodFrom, unixSecondsToIstDate } from "../utils/billingCycle.js";
import { deriveCycleStatus } from "../utils/cycleStatus.js";
import { classifyDeal, cycleLabel, latestRecurringLineItem, type DealClassification } from "../utils/monthlyEligibility.js";
import { amountSchema, hubspotIdSchema, MAX_AMOUNT, paymentDateSchema } from "../utils/validation.js";
import { pricingAdminHtml } from "./pricingAdminPage.js";

export const pricingAdminRouter = Router();

pricingAdminRouter.get("/admin/pricing", (_req: Request, res: Response) => {
  res.type("html").send(pricingAdminHtml);
});

function cycleView(job: RenewalJob) {
  const errorLog = job.error_log as { step?: string; message?: string } | null;
  // A WhatsApp failure belongs to the delivery column, and only while the
  // message is still unsent.
  const whatsappError = errorLog?.step === "whatsapp" ? (errorLog.message ?? null) : null;
  const otherError = errorLog?.message && errorLog.step !== "whatsapp" ? `${errorLog.step ?? "error"}: ${errorLog.message}` : null;
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
    zohoPaid: Boolean(job.zoho_payment_id),
    whatsappSent: job.periskope_sent,
    whatsappSkipReason: job.periskope_sent ? null : (job.periskope_skip_reason ?? whatsappError),
    emailSent: job.estimate_email_sent,
    confirmationSent: job.periskope_payment_confirmed_sent,
    invoiceEmailSent: job.invoice_email_sent,
    remindersSent: [job.reminder_1_sent_at, job.reminder_2_sent_at, job.reminder_3_sent_at].filter(Boolean).length,
    issue: job.email_error ?? otherError,
  };
}

// How the deal is billed, when its next quote goes (the deal's Next Renewal
// Date), whether that cycle already has a row, and whether the admin has
// paused it (a paused client is never "due").
function billingView(classification: DealClassification, today: string, jobs: RenewalJob[], paused: boolean) {
  if (classification.kind !== "cycle") {
    return {
      kind: classification.kind,
      label: "Not billed",
      months: null,
      due: null,
      reason: classification.reason,
      periodStart: null,
      amount: null,
      quoted: false,
      daysOverdue: null,
      paused,
    };
  }
  const quoted = classification.periodStart !== null && jobs.some((job) => job.billing_period === classification.periodStart);
  if (paused) {
    return {
      kind: "cycle",
      label: cycleLabel(classification.months),
      months: classification.months,
      due: false,
      reason: "Automatic quotes are paused on this page",
      periodStart: classification.periodStart,
      amount: classification.amount,
      quoted,
      daysOverdue: null,
      paused: true,
    };
  }
  return {
    kind: "cycle",
    label: cycleLabel(classification.months),
    months: classification.months,
    due: classification.due,
    reason: classification.due ? null : classification.reason,
    periodStart: classification.periodStart,
    amount: classification.amount,
    quoted,
    daysOverdue: classification.due ? daysBetween(classification.periodStart, today) : null,
    paused: false,
  };
}

// Where this deal's quotes and invoices are emailed: every address in the
// Accountant Email list, otherwise nowhere.
function invalidEmailTokens(value: string): string[] {
  return value.split(/[,;\s]+/).filter((token) => token && asEmail(token) === null);
}

function emailView(emails: DealEmails | undefined) {
  const accountantEmail = emails?.accountantEmail ?? null;
  return { accountantEmail, sendsTo: parseEmailList(accountantEmail), invalid: invalidEmailTokens(accountantEmail ?? "") };
}

// One-time quotes: PAID once a payment is recorded — by the Razorpay
// webhook or from the admin page.
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
      charge.status === "failed" ? "failed" : charge.paid_at ? "paid" : charge.status === "done" ? "payment_pending" : "unpaid",
    paidAt: charge.paid_at,
    paymentMethod: charge.payment_method,
    paymentAmount: charge.payment_amount,
    paymentDate: charge.payment_date,
    paymentNarration: charge.payment_narration,
    zohoPaid: Boolean(charge.zoho_payment_id),
    whatsappSent: charge.periskope_sent,
    whatsappSkipReason: charge.periskope_skip_reason,
    emailSent: charge.estimate_email_sent,
    invoiceEmailSent: charge.invoice_email_sent,
    emailError: charge.email_error,
    issue: errorLog?.message ?? null,
    createdAt: charge.created_at,
  };
}

pricingAdminRouter.get("/admin/pricing/deals", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const monthKey = billingMonthKey();
    const today = istToday();
    const [deals, pricing, clients, jobs, recentAdditions, unsettledAdditions] = await Promise.all([
      fetchVaDealsWithLineItems(),
      supabase.from("client_pricing").select("*"),
      supabase.from("clients").select("hubspot_deal_id, whatsapp_group_id").not("hubspot_deal_id", "is", null),
      findAdminCycleJobs(supabase, monthKey),
      listRecentAdditionCharges(supabase),
      findPaidUnsettledAdditionCharges(supabase),
    ]);
    // The recent list is capped; a paid quote with a step still outstanding
    // is shown however old it is.
    const additions = [
      ...recentAdditions,
      ...unsettledAdditions.filter((charge) => !recentAdditions.some((recent) => recent.id === charge.id)),
    ];
    if (pricing.error) throw new Error(pricing.error.message);
    if (clients.error) throw new Error(clients.error.message);
    const emails = await fetchVaDealEmails(deals.map((deal) => deal.dealId));

    const pricingByDealId = new Map(pricing.data?.map((r) => [r.hubspot_deal_id, r]) ?? []);
    const groupIdByDealId = new Map<string, string | null>(
      (clients.data as Array<{ hubspot_deal_id: string; whatsapp_group_id: string | null }>).map((r) => [
        r.hubspot_deal_id,
        r.whatsapp_group_id?.trim() || null,
      ]),
    );
    const jobsByDealId = new Map<string, RenewalJob[]>();
    for (const job of jobs) {
      jobsByDealId.set(job.hubspot_deal_id, [...(jobsByDealId.get(job.hubspot_deal_id) ?? []), job]);
    }

    const result = deals.map((deal) => {
      const dealJobs = jobsByDealId.get(deal.dealId) ?? [];
      const pricing = pricingByDealId.get(deal.dealId);
      const paused = pricing ? pricing.auto_quote === false : false;
      // The price HubSpot holds for this client, whatever its cycle: the
      // recurring line item with the latest billing start date.
      const priced = latestRecurringLineItem(deal.lineItems);
      const hubspotPrice = priced && priced.price > 0 ? priced.price * priced.quantity : null;
      // The one open unpaid cycle (at most one per deal, see ARCHITECTURE.md
      // §4) is the auto default for "pending since"; the admin can override it.
      const openUnpaidJob = dealJobs.find(
        (job) => job.service_period_start !== null && job.razorpay_step_status === "done" && job.paid_at === null,
      );
      const autoPendingSince = openUnpaidJob?.service_period_start ?? null;
      const effectivePendingSince = pricing?.pending_since_override ?? autoPendingSince;
      const monthsPending = effectivePendingSince
        ? monthsPendingSince(effectivePendingSince, openUnpaidJob?.term_months ?? 1, today)
        : null;
      return {
        dealId: deal.dealId,
        dealName: deal.dealName,
        dealStage: deal.dealStage,
        basePrice: pricing?.base_price ?? null,
        hubspotPrice,
        autoQuote: !paused,
        clientName: pricing?.client_name ?? null,
        whatsappGroupId: groupIdByDealId.get(deal.dealId) ?? null,
        pendingSince: {
          auto: autoPendingSince,
          override: pricing?.pending_since_override ?? null,
          effective: effectivePendingSince,
          monthsPending,
        },
        billing: billingView(classifyDeal(deal, today), today, dealJobs, paused),
        email: emailView(emails.get(deal.dealId)),
        cycles: dealJobs.map(cycleView),
      };
    });

    const dealNames = new Map(deals.map((deal) => [deal.dealId, deal.dealName]));
    res.status(200).json({
      cycle: { today, monthKey },
      deals: result,
      additions: additions.map((charge) => additionView(charge, dealNames)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to load deals", details: message });
  }
});

const savePricingSchema = z.object({
  dealId: hubspotIdSchema,
  basePrice: z.number().nonnegative().max(MAX_AMOUNT),
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

// Pause / resume a client's automatic quotes (the 11:00 IST run and the
// on-demand route both honour it).
const autoQuoteSchema = z.object({
  dealId: hubspotIdSchema,
  enabled: z.boolean(),
  dealName: z.string().optional(),
});

pricingAdminRouter.post("/admin/pricing/auto-quote", async (req: Request, res: Response) => {
  const parsed = autoQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    await setAutoQuote(getSupabaseClient(), parsed.data.dealId, parsed.data.enabled, parsed.data.dealName);
    console.log(`[pricingAdmin] deal ${parsed.data.dealId} -> automatic quotes ${parsed.data.enabled ? "resumed" : "paused"}`);
    res.status(200).json({ ok: true, enabled: parsed.data.enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to save the auto-quote setting", details: message });
  }
});

// The client's name, used to greet them ("Hi <Name>") in place of "Hi
// Team" on every message sent for this deal. Blank until the admin types
// it — never auto-filled from HubSpot.
const clientNameSchema = z.object({
  dealId: hubspotIdSchema,
  name: z.string().trim().max(200),
  dealName: z.string().optional(),
});

pricingAdminRouter.post("/admin/pricing/client-name", async (req: Request, res: Response) => {
  const parsed = clientNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    await setClientName(getSupabaseClient(), parsed.data.dealId, parsed.data.name || null, parsed.data.dealName);
    res.status(200).json({ ok: true, name: parsed.data.name || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to save the client name", details: message });
  }
});

// The date arrears are counted from. The auto default is the deal's one
// open unpaid cycle's service_period_start; the admin can override it, and
// an empty string resets to that auto default.
const pendingSinceSchema = z.object({
  dealId: hubspotIdSchema,
  pendingSince: z.union([z.literal(""), paymentDateSchema]),
  dealName: z.string().optional(),
});

pricingAdminRouter.post("/admin/pricing/pending-since", async (req: Request, res: Response) => {
  const parsed = pendingSinceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    await setPendingSinceOverride(getSupabaseClient(), parsed.data.dealId, parsed.data.pendingSince || null, parsed.data.dealName);
    res.status(200).json({ ok: true, pendingSince: parsed.data.pendingSince || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to save the pending-since date", details: message });
  }
});

// The client's WhatsApp group (clients.whatsapp_group_id): where the quote,
// invoice and reminders go, with the contact's phone as the fallback when
// it is blank. Blank clears it.
const whatsappGroupSchema = z.object({
  dealId: hubspotIdSchema,
  groupId: z.string().trim().max(64),
  dealName: z.string().trim().min(1).max(300),
});

pricingAdminRouter.post("/admin/pricing/whatsapp-group", async (req: Request, res: Response) => {
  const parsed = whatsappGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const groupId = parsed.data.groupId || null;
  if (groupId && !isValidWhatsappGroupId(groupId)) {
    res.status(400).json({ error: "Not a WhatsApp group id: expected 18 digits, or an id ending in @g.us" });
    return;
  }

  try {
    await setWhatsappGroupId(getSupabaseClient(), parsed.data.dealId, groupId, parsed.data.dealName);
    console.log(`[pricingAdmin] deal ${parsed.data.dealId} -> WhatsApp group ${groupId ? "set" : "cleared"}`);
    res.status(200).json({ ok: true, groupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to save the WhatsApp group id", details: message });
  }
});

// The Accountant Email list lives on the HubSpot deal; the page edits it
// in place. Blank clears it, and then no email is sent.
const accountantEmailsSchema = z.object({
  dealId: hubspotIdSchema,
  emails: z.string().trim().max(600),
});

pricingAdminRouter.post("/admin/pricing/accountant-email", async (req: Request, res: Response) => {
  const parsed = accountantEmailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const invalid = invalidEmailTokens(parsed.data.emails);
  if (invalid.length) {
    res.status(400).json({ error: `Not a valid email address: ${invalid.join(", ")}` });
    return;
  }
  const emails = parseEmailList(parsed.data.emails);

  try {
    await updateDealAccountantEmails(parsed.data.dealId, emails);
    console.log(`[pricingAdmin] deal ${parsed.data.dealId} -> accountant emails updated (${emails.length} set)`);
    res.status(200).json({ ok: true, emails });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to update the accountant emails in HubSpot", details: message });
  }
});

// One-time quote: service name + optional narration, sent to the group and
// by email like a renewal quote.
const sendAdditionSchema = z.object({
  dealId: hubspotIdSchema,
  amount: amountSchema,
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

// Marking something paid from the admin page — "Mark paid by Yes Bank"
// (date + narration), "Record manual payment" (amount, method, reference)
// and "Mark paid by Razorpay" for a webhook that never arrived: that one is
// only accepted when Razorpay itself shows the link as paid, and the
// payment id, amount and date are taken from Razorpay.
const recordPaymentSchema = z.object({
  jobId: z.string().min(1),
  method: z.enum(PAYMENT_METHODS),
  amount: amountSchema.optional(),
  paymentDate: paymentDateSchema.optional(),
  narration: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(100).optional(),
});

const recordAdditionPaymentSchema = recordPaymentSchema.omit({ jobId: true }).extend({ chargeId: z.string().min(1) });

type PaymentRequest = Omit<z.infer<typeof recordPaymentSchema>, "jobId">;

async function resolvePayment(
  input: PaymentRequest,
  quoteTotal: number | null,
  paymentLinkId: string | null,
): Promise<{ payment: PaymentInput } | { refused: string }> {
  if (input.method !== "razorpay") {
    return {
      payment: {
        method: input.method,
        amount: input.amount ?? quoteTotal,
        paymentDate: input.paymentDate ?? istToday(),
        narration: input.narration || null,
        reference: input.reference || null,
      },
    };
  }
  if (!paymentLinkId) {
    return { refused: "This quote has no Razorpay link, so it cannot have been paid through Razorpay" };
  }
  const link = await fetchPaymentLink(paymentLinkId);
  if (link.status !== "paid") {
    return {
      refused: `Razorpay shows this link as "${link.status}", not paid. If the client paid another way, use Record manual payment`,
    };
  }
  const captured = link.payments?.find((p) => p.status === "captured") ?? link.payments?.[0];
  return {
    payment: {
      method: "razorpay",
      amount: link.amount_paid ? link.amount_paid / 100 : quoteTotal,
      paymentDate: captured ? unixSecondsToIstDate(captured.created_at) : istToday(),
      narration: "marked paid by Razorpay from the admin page (webhook not received)",
      reference: captured?.payment_id ?? null,
    },
  };
}

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

    const resolved = await resolvePayment(parsed.data, job.zoho_estimate_total, job.razorpay_payment_link_id);
    if ("refused" in resolved) {
      res.status(409).json({ error: resolved.refused });
      return;
    }
    const result = await settleRenewalPayment(supabase, job, resolved.payment);
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

pricingAdminRouter.post("/admin/pricing/record-addition-payment", async (req: Request, res: Response) => {
  const parsed = recordAdditionPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const charge = await findAdditionChargeById(supabase, parsed.data.chargeId);
    if (!charge) {
      res.status(404).json({ error: "No one-time quote found for that id" });
      return;
    }
    if (charge.status !== "done" || !charge.zoho_estimate_id) {
      res.status(409).json({ error: "This one-time quote was not sent; a payment cannot be recorded against it" });
      return;
    }

    const resolved = await resolvePayment(parsed.data, charge.zoho_estimate_total, charge.razorpay_payment_link_id);
    if ("refused" in resolved) {
      res.status(409).json({ error: resolved.refused });
      return;
    }
    const result = await settleAdditionPayment(supabase, charge, resolved.payment);
    console.log(
      `[pricingAdmin] one-time quote ${charge.zoho_estimate_number} (deal ${charge.hubspot_deal_id}) -> ${parsed.data.method} payment ` +
        `${result.recordedPayment ? "recorded" : `not recorded (already paid via ${result.paidVia})`}` +
        (result.errors.length ? `; outstanding: ${result.errors.join("; ")}` : ""),
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof SettlementInProgressError) {
      res.status(409).json({ error: "A payment for this quote is already being processed; refresh and try again" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to record payment", details: message });
  }
});
