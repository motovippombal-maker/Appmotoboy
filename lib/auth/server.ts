import "server-only";

import { createHash } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { ApiError, consumeRateLimit } from "@/lib/backend/api";
import { phoneAuthEmail } from "@/lib/auth/phone-identity";
import { resolvePhoneIdentity } from "@/lib/auth/phone-lookup";
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
  return resolvePhoneIdentity(supabase, normalizedPhone);
}

export async function findUserEmailByPhone(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  normalizedPhone: string,
) {
  const identity = await resolvePhoneIdentity(supabase, normalizedPhone);
  return identity?.email || phoneAuthEmail(normalizedPhone);
}

export function invalidCredentials() {
  return new ApiError(401, "Celular/WhatsApp ou senha incorretos.", "INVALID_CREDENTIALS");
}
