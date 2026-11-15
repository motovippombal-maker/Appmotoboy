import { jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches, getDispatchSettings } from "@/lib/backend/dispatch";
import { distanceKm } from "@/lib/backend/routing";
import { parseCancellationPolicy } from "@/lib/backend/cancellation-policy";
import { readWithPreMarketplaceFallback } from "@/lib/backend/marketplace-schema";

async function signedAvatar(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], path?: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("driver-avatars").createSignedUrl(path, 1800);
  return data?.signedUrl || null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser(request, ["passenger", "driver"], { allowBlocked: true });
    await expireRideSearches(supabase);
    const ownerColumn = profile.role === "driver" ? "driver_id" : "passenger_id";
    const visibleRides = (useMarketColumn: boolean) => {
      const query = supabase.from("rides").select("*").eq(ownerColumn, user.id);
      return useMarketColumn && profile.role === "passenger" ? query.is("market_order_id", null) : query;
    };
    const readActiveRide = (useMarketColumn: boolean) => visibleRides(useMarketColumn)
      .not("status", "in", "(finalizada,cancelada)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: activeRide, error } = await readWithPreMarketplaceFallback("market_order_id",
      () => readActiveRide(true), () => readActiveRide(false));
    if (error) throw error;
    const { data: policySetting } = await supabase.from("system_settings").select("value")
      .eq("key", "cancellation_policy").maybeSingle();
    const cancellationPolicy = parseCancellationPolicy(policySetting?.value);
    let completedRide = null;
    let cancelledRide = null;
    if (!activeRide) {
      // Only the latest finished ride may produce the completion card. An
      // older completed ride must not reappear after a newer cancellation.
      const latestTerminalQuery = (useMarketColumn: boolean) => visibleRides(useMarketColumn)
        .in("status", ["finalizada", "cancelada"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: latestTerminal, error: terminalError } = await readWithPreMarketplaceFallback("market_order_id",
        () => latestTerminalQuery(true), () => latestTerminalQuery(false));
      if (terminalError) throw terminalError;
      completedRide = latestTerminal?.status === "finalizada" ? latestTerminal : null;
      if (profile.role === "driver") {
        const cancelledRides = <Fields extends string>(fields: Fields) => supabase.from("rides")
          .select(fields)
          .eq("driver_id", user.id).eq("status", "cancelada")
          .order("cancelled_at", { ascending: false }).limit(1);
        const { data: cancelled, error: cancelledError } = await readWithPreMarketplaceFallback("market_order_id",
          () => cancelledRides("id,driver_id,passenger_id,status,cancelled_at,cancelled_by,cancellation_fee_cents,cancellation_fee_reason")
            .is("market_order_id", null).maybeSingle(),
          () => cancelledRides("*").maybeSingle());
        if (cancelledError) throw cancelledError;
        if (cancelled) {
          const { id, driver_id, passenger_id, status, cancelled_at, cancelled_by, cancellation_fee_cents, cancellation_fee_reason } = cancelled;
          cancelledRide = { id, driver_id, passenger_id, status, cancelled_at, cancelled_by, cancellation_fee_cents, cancellation_fee_reason };
        }
      }
    }
    const ride = activeRide || completedRide;
    if (!ride) return Response.json({ ride: null, completedRide: null, cancelledRide, driverLocation: null, cancellationPolicy });

    let driver = null;
    let driverLocation = null;
    if (ride.driver_id) {
      const [{ data: driverRow }, { data: driverProfile }, { data: vehicle }, { data: location }] = await Promise.all([
        supabase.from("drivers").select("profile_id,rating,trips_count").eq("profile_id", ride.driver_id).single(),
        supabase.from("profiles").select("full_name,phone,avatar_url").eq("id", ride.driver_id).single(),
        supabase.from("vehicles").select("brand,model,color,plate").eq("driver_id", ride.driver_id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("driver_locations").select("latitude,longitude,accuracy_meters,updated_at").eq("driver_id", ride.driver_id).maybeSingle(),
      ]);
      driver = driverRow ? {
        ...driverRow,
        profiles: driverProfile ? { full_name: driverProfile.full_name, phone: driverProfile.phone, avatar_url: await signedAvatar(supabase, driverProfile.avatar_url) } : null,
        vehicles: vehicle ? [vehicle] : [],
      } : null;
      if (location) {
        const tracking = await getDispatchSettings(supabase);
        const stale = new Date(location.updated_at).getTime() < Date.now() - tracking.freshnessSeconds * 1000;
        driverLocation = {
          lat: location.latitude,
          lng: location.longitude,
          accuracyMeters: location.accuracy_meters,
          updatedAt: location.updated_at,
          stale,
          freshnessSeconds: tracking.freshnessSeconds,
          distanceToOriginMeters: Math.round(distanceKm({ lat: location.latitude, lng: location.longitude }, { lat: ride.origin_lat, lng: ride.origin_lng }) * 1000),
        };
      }
    }

    const { data: passengerProfile } = ride.market_order_id
      ? { data: null }
      : await supabase.from("profiles").select("full_name,phone").eq("id", ride.passenger_id).single();
    let trackedDistanceMeters = 0;
    if (ride.status === "em_corrida") {
      const { data: points } = await supabase.from("ride_location_points").select("latitude,longitude").eq("ride_id", ride.id).eq("accepted", true).order("recorded_at").order("id").limit(2000);
      for (let index = 1; index < (points?.length || 0); index += 1) {
        trackedDistanceMeters += Math.round(distanceKm(
          { lat: points![index - 1].latitude, lng: points![index - 1].longitude },
          { lat: points![index].latitude, lng: points![index].longitude },
        ) * 1000);
      }
    }
    // After handoff the driver only needs an identifier for the receipt, not
    // the customer, address, route geometry, or former recipient contact.
    const hydratedRide = ride.market_order_id && completedRide ? {
      id: ride.id, status: ride.status, driver_id: ride.driver_id, created_at: ride.created_at, completed_at: ride.completed_at,
      market_order_id: ride.market_order_id, market_dispatch_source: ride.market_dispatch_source,
      service_type: ride.service_type, service_details: { description: "Pedido de compras" },
    } : {
      ...ride, ...(ride.market_order_id ? { passenger_id: undefined } : {}),
      tracked_distance_meters: trackedDistanceMeters, driver, passenger: passengerProfile || null,
    };
    return Response.json({ ride: activeRide ? hydratedRide : null, completedRide: completedRide ? hydratedRide : null, cancelledRide, driverLocation: activeRide ? driverLocation : null, cancellationPolicy });
  } catch (error) { return jsonError(error); }
}
