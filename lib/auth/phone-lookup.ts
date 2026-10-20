import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/errors";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";

export async function resolvePhoneIdentity(supabase: Pick<SupabaseClient, "rpc">, phone: string) {
  const normalizedPhone = normalizeBrazilianPhone(phone);
  const { data, error } = await supabase.rpc("resolve_phone_login", { p_phone: normalizedPhone });
  if (error) {
    if (["42883", "PGRST202"].includes(error.code))
      throw new ApiError(503, "O acesso por telefone está temporariamente indisponível. Fale com a central.", "PHONE_IDENTITY_NOT_CONFIGURED");
    if (error.code === "23505")
      throw new ApiError(409, "Este telefone está associado a mais de uma conta. Fale com a central.", "PHONE_IDENTITY_CONFLICT");
    throw error;
  }
  if (data === null) return null;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.id !== "string" ||
    (data.email !== null && typeof data.email !== "string"))
    throw new ApiError(503, "Não foi possível identificar sua conta. Fale com a central.", "PHONE_IDENTITY_UNAVAILABLE");
  return { id: data.id as string, email: data.email as string | null, phone: normalizedPhone };
}

export async function assertProfilePhoneAvailable(supabase: Pick<SupabaseClient, "rpc">, profileId: string, phone: string) {
  const identity = await resolvePhoneIdentity(supabase, phone);
  if (identity && identity.id !== profileId)
    throw new ApiError(409, "Este telefone já está vinculado a outra conta.", "PHONE_ALREADY_REGISTERED");
}
