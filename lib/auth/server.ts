import "server-only";

import { createHash } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { ApiError, consumeRateLimit } from "@/lib/backend/api";
import { normalizeBrazilianPhone, phoneAuthEmail } from "@/lib/auth/phone-identity";
import { parseSupabaseUrl } from "@/lib/config/public-site-url.mjs";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export function authAttemptKey(request: Request, phone: string, action: "login" | "register") {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `auth-${action}:${createHash("sha256").update(`${address}:${phone}`).digest("hex")}`;
}

export async function rateLimitAuth(request: Request, phone: string, action: "login" | "register") {
  const supabase = createSupabaseAdminClient();
  await consumeRateLimit(supabase, authAttemptKey(request, phone, action), action === "login" ? 12 : 5, 900);
  return supabase;
}

export function createSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase público não configurado.");
  return createClient(parseSupabaseUrl(url), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function publicSession(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    expiresIn: session.expires_in,
  };
}

export async function findProfileByPhone(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  normalizedPhone: string,
) {
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("profiles")
      .select("id,phone")
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const profile = (data || []).find((item) => {
      try { return normalizeBrazilianPhone(item.phone || "") === normalizedPhone; }
      catch { return false; }
    });
    if (profile || (data || []).length < pageSize) return profile;
  }
}

export async function findUserEmailByPhone(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  normalizedPhone: string,
) {
  const profile = await findProfileByPhone(supabase, normalizedPhone);
  if (!profile) return phoneAuthEmail(normalizedPhone);
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
  if (userError) throw userError;
  return userData.user.email || phoneAuthEmail(normalizedPhone);
}

export function invalidCredentials() {
  return new ApiError(401, "Celular/WhatsApp ou senha incorretos.", "INVALID_CREDENTIALS");
}
