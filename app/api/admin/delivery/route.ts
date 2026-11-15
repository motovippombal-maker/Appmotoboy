import { z } from "zod";
import { ApiError, audit, jsonError, requireAdmin } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const [restaurants, settings, orders, metrics] = await Promise.all([
      supabase
        .from("restaurants")
        .select(
          "id,name,responsible_name,phone,document,address,city,state,status,accepting_orders,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("delivery_settings")
        .select(
          "enabled,cash_enabled,card_on_delivery_enabled,minimum_fee_cents,per_km_cents,max_distance_meters,updated_at",
        )
        .eq("singleton", true)
        .single(),
      supabase
        .from("food_orders")
        .select(
          "id,order_number,restaurant_id,status,payment_method,payment_status,total_cents,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.rpc("food_order_metrics", { p_restaurant_id: null }),
    ]);
    if (restaurants.error) throw restaurants.error;
    if (settings.error) throw settings.error;
    if (orders.error) throw orders.error;
    if (metrics.error) throw metrics.error;
    return Response.json({
      restaurants: restaurants.data || [],
      settings: settings.data,
      orders: orders.data || [],
      metrics: metrics.data,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const raw: unknown = await request.json();
    const kind = z
      .object({ kind: z.enum(["restaurant", "settings", "order"]) })
      .parse(raw).kind;
    if (kind === "restaurant") {
      const input = z
        .object({
          id: z.string().uuid(),
          status: z.enum(["approved", "rejected", "suspended"]),
        })
        .parse(raw);
      const { data, error } = await supabase
        .from("restaurants")
        .update({
          status: input.status,
          accepting_orders: false,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", input.id)
        .select("id,status")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new ApiError(
          404,
          "Restaurante não encontrado.",
          "RESTAURANT_NOT_FOUND",
        );
      await audit(
        supabase,
        user.id,
        `restaurant.${input.status}`,
        "restaurant",
        input.id,
      );
      return Response.json({ restaurant: data });
    }
    if (kind === "settings") {
      const input = z
        .object({
          enabled: z.boolean(),
          cashEnabled: z.boolean(),
          cardOnDeliveryEnabled: z.boolean(),
          minimumFeeCents: z.number().int().min(0).nullable(),
          perKmCents: z.number().int().min(0).nullable(),
          maxDistanceMeters: z.number().int().positive().nullable(),
        })
        .parse(raw);
      if (
        input.enabled &&
        (input.minimumFeeCents === null ||
          input.perKmCents === null ||
          input.maxDistanceMeters === null)
      )
        throw new ApiError(
          400,
          "Configure todos os valores antes de ativar.",
          "INVALID_DELIVERY_SETTINGS",
        );
      if (input.enabled && !input.cashEnabled && !input.cardOnDeliveryEnabled)
        throw new ApiError(
          400,
          "Habilite ao menos uma forma de pagamento.",
          "INVALID_DELIVERY_SETTINGS",
        );
      const { data, error } = await supabase
        .from("delivery_settings")
        .update({
          enabled: input.enabled,
          cash_enabled: input.cashEnabled,
          card_on_delivery_enabled: input.cardOnDeliveryEnabled,
          minimum_fee_cents: input.minimumFeeCents,
          per_km_cents: input.perKmCents,
          max_distance_meters: input.maxDistanceMeters,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("singleton", true)
        .select("*")
        .single();
      if (error) throw error;
      await audit(
        supabase,
        user.id,
        "delivery.settings_updated",
        "delivery_settings",
        undefined,
        input,
      );
      return Response.json({ settings: data });
    }
    const input = z
      .object({
        id: z.string().uuid(),
        status: z.enum(["cancelled", "delivery_failed"]),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(raw);
    const { data, error } = await supabase.rpc("transition_food_order", {
      p_order_id: input.id,
      p_actor_id: user.id,
      p_to_status: input.status,
      p_note: input.reason,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "ORDER_TRANSITION_REJECTED");
      throw error;
    }
    await audit(
      supabase,
      user.id,
      `food_order.${input.status}`,
      "food_order",
      input.id,
      { reason: input.reason },
    );
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}
