import {
  ApiError,
  audit,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { checkoutSchema } from "@/lib/delivery/schemas";
import {
  deliveryDistance,
  deliveryFeeCents,
  deliverySettings,
} from "@/lib/delivery/server";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { data, error } = await supabase
      .from("food_orders")
      .select(
        "id,order_number,restaurant_id,status,payment_method,payment_status,subtotal_cents,delivery_fee_cents,total_cents,restaurant_snapshot,created_at,food_order_items(product_id,name,quantity,unit_price_cents,options,notes,line_total_cents)",
      )
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return Response.json({ orders: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `food-order:${user.id}`, 10, 60);
    const input = checkoutSchema.parse(await request.json());
    if (
      input.expectedSubtotalCents === undefined ||
      input.expectedDeliveryFeeCents === undefined
    )
      throw new ApiError(
        400,
        "Calcule e confirme o valor antes de pedir.",
        "QUOTE_REQUIRED",
      );
    const settings = await deliverySettings(supabase);
    const { route } = await deliveryDistance(
      supabase,
      input.restaurantId,
      input.address,
    );
    deliveryFeeCents(route.distanceMeters, settings);
    const { data, error } = await supabase.rpc("create_food_order", {
      p_customer_id: user.id,
      p_restaurant_id: input.restaurantId,
      p_idempotency_key: input.idempotencyKey,
      p_items: input.items,
      p_address: input.address,
      p_distance_meters: route.distanceMeters,
      p_payment_method: input.paymentMethod,
      p_change_for_cents: input.changeForCents ?? null,
      p_expected_subtotal_cents: input.expectedSubtotalCents,
      p_expected_delivery_fee_cents: input.expectedDeliveryFeeCents,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "ORDER_REJECTED");
      throw error;
    }
    const order = Array.isArray(data) ? data[0] : data;
    if (!order)
      throw new ApiError(503, "Pedido não confirmado.", "ORDER_NOT_CREATED");
    await audit(
      supabase,
      user.id,
      "food_order.created",
      "food_order",
      order.id,
      { restaurant_id: input.restaurantId },
    );
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
