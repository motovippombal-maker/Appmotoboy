import { z } from "zod";
import { ApiError, jsonError, requireUser } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const [
      { data: preference, error: preferenceError },
      { data: driver, error: driverError },
      { data: active, error: activeError },
      { data: ready, error: readyError },
    ] = await Promise.all([
      supabase
        .from("driver_delivery_preferences")
        .select("enabled")
        .eq("driver_id", user.id)
        .maybeSingle(),
      supabase
        .from("drivers")
        .select("online,available,approval_status")
        .eq("profile_id", user.id)
        .single(),
      supabase
        .from("food_orders")
        .select(
          "id,order_number,status,restaurant_snapshot,address,delivery_fee_cents,total_cents,created_at,food_pickup_confirmations(confirmed_at)",
        )
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("food_orders")
        .select(
          "id,order_number,status,restaurant_snapshot,delivery_fee_cents,distance_meters,created_at",
        )
        .eq("status", "ready")
        .is("driver_id", null)
        .order("created_at")
        .limit(30),
    ]);
    if (preferenceError) throw preferenceError;
    if (driverError) throw driverError;
    if (activeError) throw activeError;
    if (readyError) throw readyError;
    return Response.json({
      enabled: preference?.enabled || false,
      driver,
      deliveries: active || [],
      available:
        preference?.enabled &&
        driver?.approval_status === "approved" &&
        driver.online &&
        driver.available
          ? ready || []
          : [],
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .parse(await request.json());
    const { data: driver } = await supabase
      .from("drivers")
      .select("approval_status")
      .eq("profile_id", user.id)
      .single();
    if (enabled && driver?.approval_status !== "approved")
      throw new ApiError(
        403,
        "Motorista ainda não aprovado.",
        "DRIVER_NOT_APPROVED",
      );
    const { error } = await supabase
      .from("driver_delivery_preferences")
      .upsert({
        driver_id: user.id,
        enabled,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    return Response.json({ enabled });
  } catch (error) {
    return jsonError(error);
  }
}
