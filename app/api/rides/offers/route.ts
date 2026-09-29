import { jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches } from "@/lib/backend/dispatch";
import { distanceKm } from "@/lib/backend/routing";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await expireRideSearches(supabase);
    const now = new Date().toISOString();
    const [{ data: requests, error }, { data: location }] = await Promise.all([
      supabase.from("ride_requests").select("id,ride_id,expires_at,rides(*)").eq("driver_id", user.id).eq("status", "pending").gt("expires_at", now).order("created_at", { ascending: false }),
      supabase.from("driver_locations").select("latitude,longitude").eq("driver_id", user.id).maybeSingle(),
    ]);
    if (error) throw error;
    const passengerIds = [...new Set((requests || []).map((requestRow) => {
      const ride = Array.isArray(requestRow.rides) ? requestRow.rides[0] : requestRow.rides;
      return ride?.passenger_id as string | undefined;
    }).filter(Boolean))] as string[];
    const { data: passengers } = passengerIds.length
      ? await supabase.from("profiles").select("id,full_name").in("id", passengerIds)
      : { data: [] as Array<{ id: string; full_name: string }> };
    const names = new Map((passengers || []).map((profile) => [profile.id, profile.full_name]));
    const offers = (requests || []).map((requestRow) => {
      const ride = Array.isArray(requestRow.rides) ? requestRow.rides[0] : requestRow.rides;
      const pickupDistance = location && ride ? distanceKm({ lat: location.latitude, lng: location.longitude }, { lat: ride.origin_lat, lng: ride.origin_lng }) : null;
      return {
        id: requestRow.id,
        ride_id: requestRow.ride_id,
        expires_at: requestRow.expires_at,
        passenger_name: names.get(ride?.passenger_id) || "Passageiro",
        distance_to_pickup_meters: pickupDistance === null ? null : Math.round(pickupDistance * 1000),
        ride,
      };
    });
    return Response.json({ offers });
  } catch (error) { return jsonError(error); }
}
