import { jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("passengers")
      .select("profile_id,created_at,profiles(full_name,phone,blocked)")
      .order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    const passengers = (data || []).map((item) => ({ ...item, profiles: Array.isArray(item.profiles) ? item.profiles[0] : item.profiles }));
    const ids = passengers.map((item) => item.profile_id);
    const rides = ids.length ? await supabase.from("rides").select("id,passenger_id,created_at,status,origin_address,destination_address,fare_cents,final_fare_cents").in("passenger_id", ids).order("created_at", { ascending: false }).limit(1000) : { data: [], error: null };
    if (rides.error) throw rides.error;
    return Response.json({ passengers: passengers.map((passenger) => ({ ...passenger,
      rides: (rides.data || []).filter((ride) => ride.passenger_id === passenger.profile_id),
    })) });
  } catch (error) { return jsonError(error); }
}
