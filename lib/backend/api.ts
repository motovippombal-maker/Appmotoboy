import type { User } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type AppRole = "passenger" | "driver" | "admin";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

export async function requireUser(request: Request, roles?: AppRole[]) {
  const value = request.headers.get("authorization");
  const token = value?.startsWith("Bearer ") ? value.slice(7) : null;
  if (!token)
    throw new ApiError(
      401,
      "Entre na sua conta para continuar.",
      "AUTH_REQUIRED",
    );

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
  if (profile.blocked)
    throw new ApiError(
      403,
      "Conta bloqueada. Procure a central.",
      "ACCOUNT_BLOCKED",
    );
  if (roles && !roles.includes(profile.role as AppRole))
    throw new ApiError(
      403,
      "Você não tem permissão para esta ação.",
      "FORBIDDEN",
    );

  return {
    supabase,
    user: data.user as User,
    profile: profile as typeof profile & { role: AppRole },
    token,
  };
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
      { error: error.code, message: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "INVALID_INPUT",
        message: error.issues[0]?.message || "Revise os dados informados.",
      },
      { status: 400 },
    );
  console.error("Moto SyXp API error", error);
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
  await supabase
    .from("audit_logs")
    .insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
}
