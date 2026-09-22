import type { SupabaseClient } from "@supabase/supabase-js";

// The `clients` table lives in the same Supabase project but belongs to
// another system (it is not tracked by this repo's migrations). Only its
// WhatsApp group id is read here, by HubSpot deal id (unique on that table).
export async function findWhatsappGroupId(
  supabase: SupabaseClient,
  dealId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("whatsapp_group_id")
    .eq("hubspot_deal_id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up clients row for deal ${dealId}: ${error.message}`);
  }

  const groupId = (data as { whatsapp_group_id: string | null } | null)?.whatsapp_group_id?.trim();
  return groupId ? groupId : null;
}
