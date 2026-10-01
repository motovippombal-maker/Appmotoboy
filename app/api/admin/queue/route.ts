import { z } from "zod";
import { audit, jsonError, requireAdmin } from "@/lib/backend/api";

const actionSchema = z.object({
  driverId: z.string().uuid(),
  paused: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data: drivers, error } = await supabase
      .from("drivers")
      .select(
        "profile_id, dispatch_order, queue_paused, queue_entered_at, on_shift, online, available, approval_status, profiles(full_name, blocked), vehicles(active)",
      )
      .order("dispatch_order", { ascending: true });
    if (error) throw error;
    const [ridesResult, offersResult] = await Promise.all([
      supabase
        .from("rides")
        .select("driver_id")
        .not("status", "in", "(finalizada,cancelada)")
        .not("driver_id", "is", null),
      supabase
        .from("ride_requests")
        .select("driver_id")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString()),
    ]);
    if (ridesResult.error) throw ridesResult.error;
    if (offersResult.error) throw offersResult.error;
    const onRide = new Set(
      (ridesResult.data || []).map((ride) => ride.driver_id),
    );
    const offered = new Set(
      (offersResult.data || []).map((offer) => offer.driver_id),
    );
    const queue = (drivers || []).map((driver) => {
      const profile = Array.isArray(driver.profiles)
        ? driver.profiles[0]
        : driver.profiles;
      const hasVehicle =
        driver.vehicles?.some((vehicle) => vehicle.active) ?? false;
      const status =
        driver.approval_status !== "approved" || profile?.blocked
          ? "blocked"
          : !driver.online
            ? "offline"
            : onRide.has(driver.profile_id)
              ? "on_ride"
              : offered.has(driver.profile_id)
                ? "offer"
                : driver.queue_paused
                  ? "paused"
                  : driver.on_shift && driver.available && hasVehicle
                    ? "queued"
                    : "unavailable";
      return {
        driverId: driver.profile_id,
        name: profile?.full_name || "Motorista",
        status,
        dispatchOrder: driver.dispatch_order,
        enteredAt: driver.queue_entered_at,
      };
    });
    return Response.json({ queue });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const { driverId, paused } = actionSchema.parse(await request.json());
    const { error } = await supabase.rpc("set_driver_queue_paused", {
      p_driver_id: driverId,
      p_paused: paused,
    });
    if (error) throw error;
    await audit(
      supabase,
      user.id,
      paused ? "admin.driver_queue_paused" : "admin.driver_queue_resumed",
      "driver",
      driverId,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
