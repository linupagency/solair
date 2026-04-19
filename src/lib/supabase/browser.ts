import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseBrowserClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();

  cachedClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return cachedClient;
}