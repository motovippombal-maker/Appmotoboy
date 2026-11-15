import { jsonError, requireUser } from "@/lib/backend/api";
import { readWithPreMarketplaceFallback } from "@/lib/backend/marketplace-schema";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const history = () => supabase.from("rides").select("*").eq("passenger_id", user.id).in("status", ["finalizada", "cancelada"]).order("created_at", { ascending: false }).limit(50);
    const { data: rides, error } = await readWithPreMarketplaceFallback("market_order_id",
      () => history().is("market_order_id", null), history);
    if (error) throw error;
    const driverIds = [...new Set((rides || []).map((ride) => ride.driver_id).filter(Boolean))];
    const rideIds = (rides || []).map((ride) => ride.id);
    const [{ data: drivers }, { data: ratings }, { data: payments }] = await Promise.all([
      driverIds.length ? supabase.from("profiles").select("id,full_name").in("id", driverIds) : Promise.resolve({ data: [] }),
      rideIds.length ? supabase.from("ratings").select("ride_id,score,comment,created_at").in("ride_id", rideIds).eq("rater_id", user.id) : Promise.resolve({ data: [] }),
      rideIds.length ? supabase.from("payments").select("ride_id,method,status,amount_cents,paid_at").in("ride_id", rideIds) : Promise.resolve({ data: [] }),
    ]);
    return Response.json({ rides: (rides || []).map((ride) => ({
      ...ride,
      driver_name: drivers?.find((driver) => driver.id === ride.driver_id)?.full_name || null,
      rating: ratings?.find((rating) => rating.ride_id === ride.id) || null,
      payment: payments?.find((payment) => payment.ride_id === ride.id) || null,
    })) });
  } catch (error) { return jsonError(error); }
}
