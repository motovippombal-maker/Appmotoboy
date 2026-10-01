import type { User } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/backend/errors";
import { assertProfileAccess, bearerToken, type AppRole } from "@/lib/backend/authorization";

export { ApiError } from "@/lib/backend/errors";

export type { AppRole } from "@/lib/backend/authorization";

export async function requireUser(
  request: Request,
  roles?: AppRole[],
  options: { allowBlocked?: boolean } = {},
) {
  const token = bearerToken(request);

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "Sua sessão expirou.", "INVALID_SESSION");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, phone, avatar_url, blocked")
    .eq("id", data.user.id)
    .single();
  if (profileError || !profile)
    throw new ApiError(403, "Perfil não configurado.", "PROFILE_MISSING");
  assertProfileAccess(profile as typeof profile & { role: AppRole }, roles, options);

  return {
    supabase,
    user: data.user as User,
    profile: profile as typeof profile & { role: AppRole },
    token,
  };
}

export function requireAdmin(request: Request) {
  return requireUser(request, ["admin"]);
}

export async function consumeRateLimit(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error)
    throw new ApiError(
      503,
      "Controle de tráfego indisponível.",
      "RATE_LIMIT_UNAVAILABLE",
    );
  if (!data)
    throw new ApiError(
      429,
      "Muitas tentativas. Aguarde um momento.",
      "RATE_LIMITED",
    );
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json(
      { error: error.code, message: error.message, ...error.details },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "INVALID_INPUT",
        message: "Revise os dados informados e tente novamente.",
      },
      { status: 400 },
    );
  console.error("MotoPombal API error", error);
  return Response.json(
    {
      error: "INTERNAL_ERROR",
      message: "Não foi possível concluir a operação.",
    },
    { status: 500 },
  );
}

export async function audit(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase
    .from("audit_logs")
    .insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  if (error) throw error;
}
