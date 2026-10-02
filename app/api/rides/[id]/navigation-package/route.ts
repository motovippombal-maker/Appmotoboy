import { z } from "zod";
import { ApiError, jsonError, requireUser } from "@/lib/backend/api";
import { calculateRoute } from "@/lib/backend/routing";
import { isValidCoordinates } from "@/lib/location/coordinates";

const schema = z.object({ lat: z.number(), lng: z.number(), accuracyMeters: z.number().min(0).max(500).optional() }).optional();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const requestedPoint = schema.parse(await request.json());
    if (requestedPoint && !isValidCoordinates(requestedPoint)) throw new ApiError(400, "GPS inválido.", "INVALID_GPS");
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { data: ride, error } = await supabase.from("rides")
      .select("id,driver_id,passenger_id,status,origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,route_geometry,fare_cents,fare_pricing_mode,payment_method,payment_status,created_at,accepted_at,started_at")
      .eq("id", id).eq("driver_id", user.id).maybeSingle();
    if (error) throw error;
    if (!ride || !["aceita", "motorista_a_caminho", "motorista_chegou", "em_corrida"].includes(ride.status))
      throw new ApiError(409, "Corrida ativa indisponível para preparar a navegação.", "RIDE_NOT_ACTIVE");
    // A saved, reasonably accurate position can provide a route preview when
    // the browser stops returning fixes. Never treat it as a live GPS sample.
    const { data: lastLocation } = requestedPoint ? { data: null } : await supabase.from("driver_locations")
      .select("latitude,longitude,accuracy_meters,updated_at")
      .eq("driver_id", user.id).maybeSingle();
    const serverPoint = lastLocation && Date.now() - Date.parse(lastLocation.updated_at) < 15 * 60_000
      && typeof lastLocation.accuracy_meters === "number" && lastLocation.accuracy_meters <= 500
      && isValidCoordinates({ lat: lastLocation.latitude, lng: lastLocation.longitude })
      ? { lat: lastLocation.latitude, lng: lastLocation.longitude } : null;
    const point = requestedPoint || serverPoint;
    const pickup = { lat: ride.origin_lat, lng: ride.origin_lng };
    const destination = { lat: ride.destination_lat, lng: ride.destination_lng };
    const [toPickup, toDestination] = await Promise.allSettled([
      point ? calculateRoute(point, pickup, true) : Promise.resolve(null),
      calculateRoute(pickup, destination, true),
    ]);
    const { data: passenger } = await supabase.from("profiles").select("full_name,phone").eq("id", ride.passenger_id).maybeSingle();
    return Response.json({
      ride: { ...ride, passenger: passenger ? { full_name: passenger.full_name, phone: passenger.phone } : undefined },
      routeToPickup: toPickup.status === "fulfilled" && toPickup.value ? { phase: "pickup", ...toPickup.value } : null,
      routeToDestination: toDestination.status === "fulfilled" ? { phase: "trip", ...toDestination.value } : null,
    });
  } catch (error) { return jsonError(error); }
}
