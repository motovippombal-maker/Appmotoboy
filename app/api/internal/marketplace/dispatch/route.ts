import { ApiError, jsonError } from "@/lib/backend/api";
import { marketplaceDispatchAuthorized, runMarketDispatch } from "@/lib/backend/marketplace-dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const secret = process.env.MARKETPLACE_DISPATCH_SECRET?.trim() || "";
    if (secret.length < 32)
      throw new ApiError(503, "A tarefa de distribuição ainda não foi configurada.", "MARKET_DISPATCH_NOT_CONFIGURED");
    if (!marketplaceDispatchAuthorized(request.headers.get("authorization"), secret))
      throw new ApiError(401, "Credencial inválida.", "INVALID_MARKET_DISPATCH_SECRET");
    return Response.json(await runMarketDispatch(createSupabaseAdminClient()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
