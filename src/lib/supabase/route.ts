import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export function createSupabaseRouteClient(request: NextRequest) {
  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicConfig();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // Sur nos routes JSON d'admin, on a seulement besoin de lire la session.
      },
    },
  });
}
