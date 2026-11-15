import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches } from "@/lib/backend/dispatch";
import { dispatchMarketOrder } from "@/lib/backend/marketplace-dispatch";
import { readWithPreMarketplaceFallback } from "@/lib/backend/marketplace-schema";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { data: ride, error: rideError } = await readWithPreMarketplaceFallback("market_order_id",
      () => supabase.from("rides").select("market_order_id").eq("id", id).maybeSingle(),
      () => supabase.from("rides").select("*").eq("id", id).maybeSingle());
    if (rideError) throw rideError;
    if (ride?.market_order_id) {
      const { data: orderId, error: declineError } = await supabase.rpc("decline_market_delivery", { p_ride_id: id, p_driver_id: user.id });
      if (declineError) throw declineError;
      if (!orderId) throw new ApiError(409, "Esta oferta não está mais disponível.", "OFFER_UNAVAILABLE");
      try { await dispatchMarketOrder(supabase, orderId); } catch { /* A próxima execução agendada retoma a entrega. */ }
      return Response.json({ declined: true, rideId: id });
    }
    const { data, error } = await supabase.from("ride_requests")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("ride_id", id).eq("driver_id", user.id).eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "Esta oferta não está mais disponível.", "OFFER_UNAVAILABLE");
    await expireRideSearches(supabase, id);
    await audit(supabase, user.id, "ride.declined", "ride", id);
    return Response.json({ declined: true, rideId: id });
  } catch (error) { return jsonError(error); }
}
