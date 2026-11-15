import { jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches } from "@/lib/backend/dispatch";
import { distanceKm } from "@/lib/backend/routing";
import { rideServiceOfferDetails } from "@/lib/ride-service";
import { readWithPreMarketplaceFallback } from "@/lib/backend/marketplace-schema";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await expireRideSearches(supabase);
    const now = new Date().toISOString();
    const readOffers = <Fields extends string>(fields: Fields) => supabase.from("ride_requests").select(fields)
      .eq("driver_id", user.id).eq("status", "pending").gt("expires_at", now).order("created_at", { ascending: false });
    const [{ data: requests, error }, { data: location }] = await Promise.all([
      readWithPreMarketplaceFallback("market_dispatch_source",
        () => readOffers("id,ride_id,expires_at,market_dispatch_source,rides(*)"),
        () => readOffers("*,rides(*)")),
      supabase.from("driver_locations").select("latitude,longitude,updated_at").eq("driver_id", user.id).maybeSingle(),
    ]);
    if (error) throw error;
    const passengerIds = [...new Set((requests || []).map((requestRow) => {
      const ride = Array.isArray(requestRow.rides) ? requestRow.rides[0] : requestRow.rides;
      return !ride?.market_order_id ? ride?.passenger_id as string | undefined : undefined;
    }).filter(Boolean))] as string[];
    const { data: passengers } = passengerIds.length
      ? await supabase.from("profiles").select("id,full_name").in("id", passengerIds)
      : { data: [] as Array<{ id: string; full_name: string }> };
    const names = new Map((passengers || []).map((profile) => [profile.id, profile.full_name]));
    const offers = (requests || []).map((requestRow) => {
      const ride = Array.isArray(requestRow.rides) ? requestRow.rides[0] : requestRow.rides;
      const age = location ? Date.now() - Date.parse(location.updated_at) : Infinity;
      const gpsFresh = location && age >= -30_000 && age <= 90_000;
      const pickupDistance = gpsFresh && ride ? distanceKm({ lat: location.latitude, lng: location.longitude }, { lat: ride.origin_lat, lng: ride.origin_lng }) : null;
      const marketOrder = Boolean(ride?.market_order_id);
      return {
        id: requestRow.id,
        ride_id: requestRow.ride_id,
        expires_at: requestRow.expires_at,
        passenger_name: marketOrder ? "Pedido de loja" : names.get(ride?.passenger_id) || "Passageiro",
        distance_to_pickup_meters: pickupDistance === null ? null : Math.round(pickupDistance * 1000),
        estimated_time_to_pickup_seconds: marketOrder || pickupDistance === null ? null : Math.max(60, Math.round((pickupDistance * 1000) / 7)),
        // O contato do destinatário só é disponibilizado ao motorista vinculado,
        // nos endpoints de corrida ativa e navegação após o aceite.
        ride: !ride ? ride : marketOrder ? {
          id: ride.id, status: ride.status, service_type: ride.service_type,
          market_order_id: ride.market_order_id,
          market_dispatch_source: requestRow.market_dispatch_source,
          origin_address: ride.origin_address, origin_lat: ride.origin_lat, origin_lng: ride.origin_lng,
          destination_address: "Endereço da entrega após aceitar", destination_lat: null, destination_lng: null,
          distance_meters: ride.estimated_distance_meters ?? null,
          duration_seconds: ride.estimated_duration_seconds ?? null,
          fare_cents: ride.fare_cents, estimated_fare_cents: ride.estimated_fare_cents, payment_method: "cash",
          service_details: { description: "Pedido de compras" },
        } : { ...ride, service_details: rideServiceOfferDetails(ride.service_details) },
      };
    });
    return Response.json({ offers });
  } catch (error) { return jsonError(error); }
}
