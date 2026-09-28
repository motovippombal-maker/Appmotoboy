import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { findNearbyDrivers } from "@/lib/backend/dispatch";
import { calculateRoute } from "@/lib/backend/routing";
import { requireConfiguredFare } from "@/lib/backend/fare";
import { resolveRegionFare, reverseDestination } from "@/lib/backend/region-fare";

const schema = z.object({
  origin: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  destination: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  paymentMethod: z.enum(["pix", "cash"]).default("pix"),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `ride-request:${user.id}`, 4, 60);
    const input = schema.parse(await request.json());
    const { data: existingRide } = await supabase.from("rides").select("id,status").eq("passenger_id", user.id).not("status", "in", "(finalizada,cancelada)").limit(1).maybeSingle();
    if (existingRide) throw new ApiError(409, "Você já possui uma corrida ativa. O estado atual foi preservado.", "ACTIVE_RIDE_EXISTS");
    const [route, nearbyResult, verifiedDestination] = await Promise.all([
      calculateRoute(input.origin, input.destination),
      findNearbyDrivers(supabase, input.origin),
      reverseDestination(input.destination.lat, input.destination.lng),
    ]);
    const { drivers: nearby, config } = nearbyResult;
    if (!nearby.length) throw new ApiError(409, "Nenhum motorista online e com GPS recente foi encontrado neste raio.", "NO_NEARBY_DRIVERS");
    const { data: fareConfig } = await supabase.from("system_settings").select("value").eq("key", "fare").single();
    requireConfiguredFare(fareConfig?.value);
    const regionalFare = await resolveRegionFare(supabase, verifiedDestination.displayName, verifiedDestination.labels);
    const { data: ride, error } = await supabase.from("rides").insert({ passenger_id: user.id, status: "procurando_motorista", origin_address: input.origin.address, origin_lat: input.origin.lat, origin_lng: input.origin.lng, destination_address: input.destination.address, destination_lat: input.destination.lat, destination_lng: input.destination.lng, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds, route_geometry: route.geometry, fare_cents: regionalFare.fareCents, estimated_distance_meters: route.distanceMeters, estimated_duration_seconds: route.durationSeconds, estimated_fare_cents: regionalFare.fareCents, fare_region_id: regionalFare.fareRegion.id, fare_region_name: regionalFare.fareRegion.name, fare_pricing_mode: "region", fare_rule_snapshot: regionalFare.snapshot, payment_method: input.paymentMethod }).select().single();
    if (error?.code === "23505") throw new ApiError(409, "A corrida já foi solicitada. Sincronize para acompanhar o estado atual.", "RIDE_REQUEST_ALREADY_EXISTS");
    if (error || !ride) throw error || new Error("Ride creation failed");

    const { error: offersError } = await supabase.from("ride_requests").insert(nearby.map((driver) => ({ ride_id: ride.id, driver_id: driver.driverId, expires_at: new Date(Date.now() + config.offerSeconds * 1000).toISOString() })));
    if (offersError) {
      await supabase.from("rides").update({ status: "cancelada", cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: "Falha ao distribuir a solicitação" }).eq("id", ride.id);
      throw new ApiError(503, "Não foi possível avisar os motoristas agora.", "DISPATCH_FAILED");
    }
    await supabase.from("passenger_locations").upsert({ passenger_id: user.id, ride_id: ride.id, latitude: input.origin.lat, longitude: input.origin.lng });
    await supabase.from("ride_history").insert({ ride_id: ride.id, to_status: "procurando_motorista", actor_id: user.id });
    await audit(supabase, user.id, "ride.requested", "ride", ride.id, { offered_drivers: nearby.length, fare_region_id: regionalFare.fareRegion.id, fare_region_name: regionalFare.fareRegion.name, fare_cents: regionalFare.fareCents });
    return Response.json({ ride, offeredDrivers: nearby.length, radiusKm: config.radiusKm }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
