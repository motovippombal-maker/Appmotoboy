import { jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches, getDispatchSettings } from "@/lib/backend/dispatch";
import { distanceKm } from "@/lib/backend/routing";

async function signedAvatar(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], path?: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("driver-avatars").createSignedUrl(path, 1800);
  return data?.signedUrl || null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser(request, ["passenger", "driver"]);
    await expireRideSearches(supabase);
    const ownerColumn = profile.role === "driver" ? "driver_id" : "passenger_id";
    const { data: activeRide, error } = await supabase.from("rides").select("*").eq(ownerColumn, user.id).not("status", "in", "(finalizada,cancelada)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    let completedRide = null;
    if (!activeRide && profile.role === "passenger") {
      const { data, error: completedError } = await supabase.from("rides").select("*").eq("passenger_id", user.id).eq("status", "finalizada").order("completed_at", { ascending: false }).limit(1).maybeSingle();
      if (completedError) throw completedError;
      completedRide = data;
    }
    const ride = activeRide || completedRide;
    if (!ride) return Response.json({ ride: null, completedRide: null, driverLocation: null });

    let driver = null;
    let driverLocation = null;
    if (ride.driver_id) {
      const [{ data: driverRow }, { data: driverProfile }, { data: vehicle }, { data: location }] = await Promise.all([
        supabase.from("drivers").select("profile_id,rating").eq("profile_id", ride.driver_id).single(),
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

    const { data: passengerProfile } = await supabase.from("profiles").select("full_name,phone").eq("id", ride.passenger_id).single();
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
    const hydratedRide = { ...ride, tracked_distance_meters: trackedDistanceMeters, driver, passenger: passengerProfile || null };
    return Response.json({ ride: activeRide ? hydratedRide : null, completedRide: completedRide ? hydratedRide : null, driverLocation: activeRide ? driverLocation : null });
  } catch (error) { return jsonError(error); }
}
