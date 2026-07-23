import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export function getSupabaseClient() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey);
}
