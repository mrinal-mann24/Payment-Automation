import type { SupabaseClient } from "@supabase/supabase-js";

export interface ClientPricing {
  id: string;
  hubspot_deal_id: string;
  deal_name: string | null;
  base_price: number | null; // null = only a pause setting so far; a monthly cycle refuses to bill without it
  auto_quote: boolean; // false = the admin switched this client's automatic quotes off
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

// Admin page: pause or resume a client's automatic quotes. A term client may
// have no row yet (it needs no base price), so this upserts one.
export async function setAutoQuote(
  supabase: SupabaseClient,
  dealId: string,
  enabled: boolean,
  dealName?: string,
): Promise<void> {
  const { error } = await supabase
    .from("client_pricing")
    .upsert(
      {
        hubspot_deal_id: dealId,
        auto_quote: enabled,
        ...(dealName ? { deal_name: dealName } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hubspot_deal_id" },
    );

  if (error) {
    throw new Error(`Failed to save the auto-quote setting: ${error.message}`);
  }
}

export async function findPausedDealIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("client_pricing").select("hubspot_deal_id").eq("auto_quote", false);

  if (error) {
    throw new Error(`Failed to look up paused clients: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.hubspot_deal_id as string));
}
