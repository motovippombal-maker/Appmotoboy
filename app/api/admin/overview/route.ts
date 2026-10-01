import { jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => dateParts.find((item) => item.type === type)!.value;
    const start = new Date(`${part("year")}-${part("month")}-${part("day")}T03:00:00.000Z`);
    const [ridesTodayResult, driversResult, recentResult] = await Promise.all([
      supabase.from("rides").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString()),
      supabase.from("drivers").select("online,available").eq("approval_status", "approved"),
      supabase.from("rides").select("id,passenger_id,origin_address,destination_address,status,fare_cents,final_fare_cents,payment_method,payment_status").order("created_at", { ascending: false }).limit(8),
    ]);
    for (const result of [ridesTodayResult, driversResult, recentResult]) {
      if (result.error) throw result.error;
    }
    const drivers = driversResult.data || [];
    const completed: Array<{ fare_cents: number; final_fare_cents: number | null; requested_at: string; accepted_at: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("rides")
        .select("fare_cents,final_fare_cents,requested_at,accepted_at")
        .eq("status", "finalizada").gte("finished_at", start.toISOString())
        .order("requested_at").range(offset, offset + 999);
      if (error) throw error;
      completed.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const waits = completed.filter((ride) => ride.accepted_at).map((ride) =>
      (new Date(ride.accepted_at!).getTime() - new Date(ride.requested_at).getTime()) / 60000,
    );
    return Response.json({
      ridesToday: ridesTodayResult.count || 0,
      driversOnline: drivers.filter((driver) => driver.online).length,
      driversAvailable: drivers.filter((driver) => driver.available).length,
      averageWaitMinutes: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0,
      revenueCents: completed.reduce((sum, ride) => sum + (ride.final_fare_cents ?? ride.fare_cents), 0),
      recentRides: recentResult.data || [],
    });
  } catch (error) {
    return jsonError(error);
  }
}
