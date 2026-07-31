import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClientPricing {
  id: string;
  hubspot_deal_id: string;
  deal_name: string | null;
  base_price: number;
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
  dealName?: string,
): Promise<void> {
  const { error } = await supabase
    .from("client_pricing")
    .upsert(
      {
        hubspot_deal_id: dealId,
        base_price: basePrice,
        ...(dealName ? { deal_name: dealName } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hubspot_deal_id" },
    );

  if (error) {
    throw new Error(`Failed to save client_pricing row: ${error.message}`);
  }
}
