import { ApiError } from "./errors";

export type AppRole = "passenger" | "driver" | "admin";

export function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  const token = value?.startsWith("Bearer ") ? value.slice(7) : null;
  if (!token)
    throw new ApiError(401, "Entre na sua conta para continuar.", "AUTH_REQUIRED");
  return token;
}

export function assertProfileAccess(
  profile: { role: AppRole; blocked: boolean },
  roles?: AppRole[],
  options: { allowBlocked?: boolean } = {},
) {
  if (profile.blocked && !options.allowBlocked)
    throw new ApiError(403, "Conta bloqueada. Procure a central.", "ACCOUNT_BLOCKED");
  if (roles && !roles.includes(profile.role))
    throw new ApiError(403, "Você não tem permissão para esta ação.", "FORBIDDEN");
}
