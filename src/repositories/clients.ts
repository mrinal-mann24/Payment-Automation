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

// Set from the admin page. The row belongs to the other system, so an
// existing row is updated in place (nothing else on it is touched); only
// when the deal has no row yet is one created, with the required
// client_name taken from the HubSpot deal name.
export async function setWhatsappGroupId(
  supabase: SupabaseClient,
  dealId: string,
  groupId: string | null,
  dealName: string,
): Promise<void> {
  const updated = await supabase
    .from("clients")
    .update({ whatsapp_group_id: groupId })
    .eq("hubspot_deal_id", dealId)
    .select("client_id");
  if (updated.error) {
    throw new Error(`Failed to update clients row for deal ${dealId}: ${updated.error.message}`);
  }
  if (updated.data?.length) {
    return;
  }

  const inserted = await supabase
    .from("clients")
    .insert({ hubspot_deal_id: dealId, client_name: dealName, whatsapp_group_id: groupId });
  if (inserted.error) {
    throw new Error(`Failed to create clients row for deal ${dealId}: ${inserted.error.message}`);
  }
}
