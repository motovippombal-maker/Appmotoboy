import { jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("ride_driver_cancellations")
      .select("id,ride_id,driver_id,passenger_id,previous_status,reason_code,reason_text,accepted_at,arrived_at,cancelled_at,gps_lat,gps_lng,gps_accuracy_meters,gps_recorded_at,next_driver_id,next_accepted_at")
      .order("cancelled_at", { ascending: false }).limit(200);
    if (error) throw error;
    const cancellations = data || [];
    const rideIds = [...new Set(cancellations.map((item) => item.ride_id))];
    const profileIds = [...new Set(cancellations.flatMap((item) =>
      [item.driver_id, item.passenger_id, item.next_driver_id]).filter((id): id is string => Boolean(id)))];
    const [rideResult, profileResult, metricsResult] = await Promise.all([
      rideIds.length ? supabase.from("rides").select("id,origin_address,destination_address,requested_at,status")
        .in("id", rideIds) : Promise.resolve({ data: [], error: null }),
      profileIds.length ? supabase.from("profiles").select("id,full_name").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("driver_cancellation_metrics").select("driver_id,accepted,completed,cancelled,cancellation_rate")
        .gt("accepted", 0).order("cancelled", { ascending: false }).limit(200),
    ]);
    for (const result of [rideResult, profileResult, metricsResult]) {
      if (result.error) throw result.error;
    }
    const rides = new Map((rideResult.data || []).map((ride) => [ride.id, ride]));
    const profiles = new Map((profileResult.data || []).map((profile) => [profile.id, profile.full_name]));
    const metricIds = (metricsResult.data || []).map((item) => item.driver_id);
    const missingIds = metricIds.filter((id) => !profiles.has(id));
    if (missingIds.length) {
      const missing = await supabase.from("profiles").select("id,full_name").in("id", missingIds);
      if (missing.error) throw missing.error;
      for (const profile of missing.data || []) profiles.set(profile.id, profile.full_name);
    }
    return Response.json({ cancellations: cancellations.map((item) => ({
      ...item, ride: rides.get(item.ride_id) || null,
      driver_name: profiles.get(item.driver_id) || "Motorista",
      passenger_name: profiles.get(item.passenger_id) || "Passageiro",
      next_driver_name: item.next_driver_id ? profiles.get(item.next_driver_id) || "Motorista" : null,
    })), metrics: (metricsResult.data || []).map((item) => ({
      ...item, driver_name: profiles.get(item.driver_id) || "Motorista",
    })) });
  } catch (error) { return jsonError(error); }
}
