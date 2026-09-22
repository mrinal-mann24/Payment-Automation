import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { config } from "../config.js";
import { fetchDealStage, fetchVaDealsWithLineItems, VA_ACTIVE_CUSTOMER_DEALSTAGES } from "../clients/hubspot.js";
import { runRenewalPipeline } from "../jobs/renewalPipeline.js";
import { currentBillingCycle } from "../utils/billingCycle.js";
import { classifyDeal, type DealClassification } from "../utils/monthlyEligibility.js";

const renewalWebhookSchema = z.object({
  deal_id: z.string().min(1),
});

export const renewalWebhookRouter = Router();

function isAuthorized(req: Request): boolean {
  const provided = req.header("x-webhook-secret") ?? "";
  const expected = config.renewalWebhook.sharedSecret;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // Lengths must match before timingSafeEqual, but comparing that check
  // itself in non-constant time is fine — it doesn't leak the secret's
  // content, only its length, which isn't sensitive here.
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

renewalWebhookRouter.post("/webhooks/renewal", async (req: Request, res: Response) => {
  console.log("[renewalWebhook] received request");

  if (!isAuthorized(req)) {
    console.log("[renewalWebhook] rejected: missing or invalid x-webhook-secret header");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = renewalWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log("[renewalWebhook] rejected: invalid payload");
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { deal_id: dealId } = parsed.data;
  console.log(`[renewalWebhook] deal ${dealId} -> creating Zoho estimate`);
  const supabase = getSupabaseClient();

  try {
    // Same active-customer gate the automatic cron applies (see
    // ARCHITECTURE.md §3.1) — this route previously bypassed it entirely,
    // so any caller could trigger a real charge for a deal that's lost,
    // discarded, or pre-sale. deal_id itself is untrusted input; fetching
    // the stage re-validates against the live HubSpot record.
    const dealStage = await fetchDealStage(dealId);
    if (!VA_ACTIVE_CUSTOMER_DEALSTAGES.includes(dealStage)) {
      console.log(
        `[renewalWebhook] deal ${dealId} rejected: dealstage ${dealStage} is not an active-customer stage`,
      );
      res.status(409).json({
        error: "Deal is not in an active-customer stage",
        dealStage,
      });
      return;
    }

    // Same classification as the daily tick: a monthly deal gets the current
    // IST month's cycle (so this route doubles as "generate now" after the
    // 1st-4th window); anything else runs the legacy due-date flow.
    const cycle = currentBillingCycle();
    const listed = (await fetchVaDealsWithLineItems()).find((deal) => deal.dealId === dealId);
    const classification: DealClassification = listed
      ? classifyDeal(listed, cycle.period.start)
      : { monthly: false, reason: "deal is not in the active VA deal list" };
    if (classification.monthly && !classification.due) {
      console.log(`[renewalWebhook] deal ${dealId} rejected: ${classification.reason}`);
      res.status(409).json({ error: "Monthly deal is not due for this month", reason: classification.reason });
      return;
    }

    const result = await runRenewalPipeline(supabase, dealId, classification.monthly ? cycle : undefined);
    console.log(
      `[renewalWebhook] deal ${dealId} (${classification.monthly ? "monthly" : "legacy"}) -> estimate ${result.zohoEstimateNumber}, ` +
        `link ${result.shortUrl}, WhatsApp ${result.periskopeSent ? "sent" : `skipped: ${result.periskopeSkipReason}`}, ` +
        `email ${result.emailSent ? "sent" : `not sent: ${result.emailError}`}`,
    );

    res.status(200).json({ monthly: classification.monthly, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[renewalWebhook] deal ${dealId} failed: ${message}`);
    res.status(502).json({ error: "Failed to run renewal pipeline", details: message });
  }
});
