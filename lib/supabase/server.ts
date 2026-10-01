import "server-only";

import { createClient } from "@supabase/supabase-js";
import { parseSupabaseUrl } from "@/lib/config/public-site-url.mjs";

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("As variáveis privadas do Supabase não foram configuradas.");
  }

  return createClient(parseSupabaseUrl(url), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
