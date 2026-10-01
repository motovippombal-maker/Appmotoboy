import { jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data: drivers, error: driverError } = await supabase.from("drivers")
      .select("profile_id,available,updated_at,profiles(full_name,avatar_url)").eq("approval_status", "approved").eq("online", true);
    if (driverError) throw driverError;
    const ids = (drivers || []).map((driver) => driver.profile_id);
    if (!ids.length) return Response.json({ drivers: [] });
    const freshness = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: locations, error } = await supabase.from("driver_locations")
      .select("driver_id,latitude,longitude,updated_at")
      .in("driver_id", ids).gte("updated_at", freshness).limit(500);
    if (error) throw error;
    const active = await supabase.from("rides").select("id,driver_id,origin_address,destination_address,status")
      .in("driver_id", ids).not("status", "in", "(finalizada,cancelada)");
    if (active.error) throw active.error;
    const driverById = new Map((drivers || []).map((driver) => [driver.profile_id, driver]));
    const rideByDriver = new Map((active.data || []).map((ride) => [ride.driver_id, ride]));
    return Response.json({ drivers: (locations || []).map((location) => ({
      markerId: location.driver_id,
      latitude: location.latitude,
      longitude: location.longitude,
      distanceMeters: 0,
      name: (() => { const profile = driverById.get(location.driver_id)?.profiles; return (Array.isArray(profile) ? profile[0] : profile)?.full_name || "Motorista"; })(),
      available: Boolean(driverById.get(location.driver_id)?.available),
      onlineSince: driverById.get(location.driver_id)?.updated_at || location.updated_at,
      currentRide: rideByDriver.get(location.driver_id) || null,
      updatedAt: location.updated_at,
    })) });
  } catch (error) {
    return jsonError(error);
  }
}
