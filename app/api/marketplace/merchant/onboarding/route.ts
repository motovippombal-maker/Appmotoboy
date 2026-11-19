import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { storeOnboardingInput, storeOnboardingResult, throwStoreOnboardingError } from "@/lib/marketplace/store-onboarding";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    await requireMarketplaceOperations(supabase);
    await consumeRateLimit(supabase, `market-register-store:${user.id}`, 5, 900);
    const { idempotencyKey, ...data } = storeOnboardingInput.parse(await request.json());
    const result = await supabase.rpc("market_register_store", {
      p_actor_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_data: data,
    });
    if (result.error) throwStoreOnboardingError(result.error);
    const parsed = storeOnboardingResult.safeParse(result.data);
    if (!parsed.success)
      throw new ApiError(503, "A confirmação do cadastro está incompleta. Atualize o painel e consulte suas lojas.", "MARKET_REGISTRATION_UNAVAILABLE");
    return Response.json(parsed.data, { status: parsed.data.reused ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
