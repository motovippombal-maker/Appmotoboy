import { jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("rides")
      .select("id,passenger_id,driver_id,origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,distance_meters,fare_cents,final_fare_cents,payment_method,payment_status,status,requested_at,created_at,accepted_at,arrived_at,started_at,finished_at,cancelled_at,cancelled_by,cancellation_reason,cancellation_fee_cents,cancellation_fee_reason,cancellation_evidence,termination_code,no_show_at,early_end_reason,early_end_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const rides = data || [];
    const ids = [...new Set(rides.flatMap((ride) => [ride.passenger_id, ride.driver_id]).filter((id): id is string => Boolean(id)))];
    const profiles = ids.length ? await supabase.from("profiles").select("id,full_name,phone").in("id", ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const names = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
    return Response.json({ rides: rides.map((ride) => ({ ...ride,
      passenger: names.get(ride.passenger_id) || null,
      driver: ride.driver_id ? names.get(ride.driver_id) || null : null,
    })) });
  } catch (error) { return jsonError(error); }
}
