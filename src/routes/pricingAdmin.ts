import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSupabaseClient } from "../clients/supabase.js";
import { fetchVaPipelineDeals } from "../clients/hubspot.js";
import { upsertClientPricing } from "../repositories/clientPricing.js";
import { createAdditionCharge } from "../steps/createAdditionCharge.js";
import { pricingAdminHtml } from "./pricingAdminPage.js";

export const pricingAdminRouter = Router();

pricingAdminRouter.get("/admin/pricing", (_req: Request, res: Response) => {
  res.type("html").send(pricingAdminHtml);
});

pricingAdminRouter.get("/admin/pricing/deals", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const deals = await fetchVaPipelineDeals();
    const { data: pricingRows, error } = await supabase.from("client_pricing").select("*");
    if (error) throw new Error(error.message);

    const pricingByDealId = new Map(pricingRows?.map((r) => [r.hubspot_deal_id, r]) ?? []);
    const result = deals.map((deal) => {
      const pricing = pricingByDealId.get(deal.dealId);
      return {
        dealId: deal.dealId,
        dealName: deal.dealName,
        dealStage: deal.dealStage,
        basePrice: pricing?.base_price ?? null,
      };
    });

    res.status(200).json({ deals: result });
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
