import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { cashConfirmationSchema } from "@/lib/backend/payment";
import { readWithPreMarketplaceFallback } from "@/lib/backend/marketplace-schema";

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser(request, ["driver", "admin"]);
    const { rideId } = cashConfirmationSchema.parse(await request.json());
    await consumeRateLimit(supabase, `cash-confirm:${user.id}`, 12, 60);

    const readRide = <Fields extends string>(fields: Fields) => supabase
      .from("rides")
      .select(fields)
      .eq("id", rideId)
      .maybeSingle();
    const { data: ride, error: rideError } = await readWithPreMarketplaceFallback("market_order_id",
      () => readRide("id,driver_id,status,payment_method,final_fare_cents,fare_cents,market_order_id"),
      () => readRide("*"));
    if (rideError) throw rideError;
    if (!ride) throw new ApiError(404, "Corrida não encontrada.", "RIDE_NOT_FOUND");
    if (profile.role !== "admin" && ride.driver_id !== user.id)
      throw new ApiError(403, "Somente o motorista vinculado ou a administração pode confirmar.", "FORBIDDEN");
    if (ride.market_order_id)
      throw new ApiError(409, "Confirme o recebimento no pedido de compras.", "MARKET_CASH_SEPARATE");
    if (ride.status !== "finalizada" || ride.payment_method !== "cash" ||
      (ride.final_fare_cents ?? ride.fare_cents) <= 0)
      throw new ApiError(409, "Esta corrida não admite confirmação em dinheiro.", "CASH_NOT_ALLOWED");

    const { data, error } = await supabase.rpc("confirm_cash_payment", {
      p_ride_id: rideId,
      p_actor_id: user.id,
    });
    if (error) throw new ApiError(409, "O pagamento não pôde ser confirmado. Atualize a corrida.", "CASH_CONFIRMATION_FAILED");
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
