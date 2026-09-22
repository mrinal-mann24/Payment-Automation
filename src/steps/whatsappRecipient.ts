import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidWhatsappRecipient } from "../clients/periskope.js";
import { findWhatsappGroupId } from "../repositories/clients.js";

export type WhatsappRecipient =
  | { recipient: string; skipReason: null }
  | { recipient: null; skipReason: string };

// The client's WhatsApp group (clients.whatsapp_group_id, keyed by deal) is
// preferred; the HubSpot contact phone is the fallback. A failed group
// lookup also falls back — that table belongs to another system, and a
// missing or late row must not stop a quote or confirmation going out.
export async function resolveWhatsappRecipient(
  supabase: SupabaseClient,
  dealId: string,
  contactPhone: string | null,
): Promise<WhatsappRecipient> {
  let groupId: string | null = null;
  try {
    groupId = await findWhatsappGroupId(supabase, dealId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] group lookup failed for deal ${dealId}, falling back to contact phone: ${message}`);
  }

  const candidate = groupId ?? contactPhone;
  if (!candidate) {
    return { recipient: null, skipReason: `No WhatsApp identifier (group id or contact phone) found for deal ${dealId}` };
  }
  if (!isValidWhatsappRecipient(candidate)) {
    return {
      recipient: null,
      skipReason: `WhatsApp identifier for deal ${dealId} is not a valid group id or phone number: ${candidate}`,
    };
  }
  return { recipient: candidate, skipReason: null };
}
