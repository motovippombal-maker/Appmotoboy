import { audit, consumeRateLimit, jsonError, requireUser, ApiError } from "@/lib/backend/api";
import { assertFreshDriverLocation } from "@/lib/backend/dispatch";

const acceptedStatuses = ["aceita", "motorista_a_caminho", "motorista_chegou", "em_corrida"];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser(request, ["driver"]);
    await consumeRateLimit(supabase, `ride-accept:${user.id}`, 12, 60);
    const { data: currentRide } = await supabase.from("rides").select("driver_id,status").eq("id", id).maybeSingle();
    if (currentRide?.driver_id === user.id && acceptedStatuses.includes(currentRide.status)) {
      return Response.json({ accepted: true, rideId: id, duplicate: true });
    }
    const now = new Date().toISOString();
    const { data: offer } = await supabase.from("ride_requests").select("id").eq("ride_id", id).eq("driver_id", user.id).eq("status", "pending").gt("expires_at", now).maybeSingle();
    if (!offer) {
      const { data: acceptedRide } = await supabase.from("rides").select("driver_id,status").eq("id", id).maybeSingle();
      if (acceptedRide?.driver_id === user.id && acceptedStatuses.includes(acceptedRide.status)) {
        return Response.json({ accepted: true, rideId: id, duplicate: true });
      }
      throw new ApiError(409, "Esta oferta expirou ou não foi destinada a você.", "OFFER_UNAVAILABLE");
    }
    await assertFreshDriverLocation(supabase, user.id);
    const { data, error } = await supabase.rpc("accept_ride", { p_ride_id: id, p_driver_id: user.id });
    if (error) throw error;
    if (!data) {
      const { data: acceptedRide } = await supabase.from("rides").select("driver_id,status").eq("id", id).maybeSingle();
      if (acceptedRide?.driver_id === user.id && acceptedStatuses.includes(acceptedRide.status)) {
        return Response.json({ accepted: true, rideId: id, duplicate: true });
      }
      throw new ApiError(409, "Esta corrida já foi aceita ou não está mais disponível.", "RIDE_ALREADY_TAKEN");
    }
    await audit(supabase, user.id, "ride.accepted", "ride", id);
    return Response.json({ accepted: true, rideId: id });
  } catch (error) { return jsonError(error); }
}
