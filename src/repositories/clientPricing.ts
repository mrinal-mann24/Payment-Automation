import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClientPricing {
  id: string;
  hubspot_deal_id: string;
  base_price: number;
  addition_price: number;
  created_at: string;
  updated_at: string;
}

export async function findClientPricing(
  supabase: SupabaseClient,
  dealId: string,
): Promise<ClientPricing | null> {
  const { data, error } = await supabase
    .from("client_pricing")
    .select("*")
    .eq("hubspot_deal_id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up client_pricing row: ${error.message}`);
  }

  return data as ClientPricing | null;
}

export async function upsertClientPricing(
  supabase: SupabaseClient,
  dealId: string,
  basePrice: number,
): Promise<void> {
  const { error } = await supabase
    .from("client_pricing")
    .upsert(
      { hubspot_deal_id: dealId, base_price: basePrice, updated_at: new Date().toISOString() },
      { onConflict: "hubspot_deal_id" },
    );

  if (error) {
    throw new Error(`Failed to save client_pricing row: ${error.message}`);
  }
}
