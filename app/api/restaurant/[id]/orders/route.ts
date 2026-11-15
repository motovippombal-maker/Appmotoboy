import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";
import { restaurantForStaff } from "@/lib/delivery/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request);
    const restaurantId = z
      .string()
      .uuid()
      .parse((await context.params).id);
    await restaurantForStaff(supabase, restaurantId, user.id);
    const [{ data, error }, { data: metrics, error: metricsError }] =
      await Promise.all([
        supabase
          .from("food_orders")
          .select(
            "id,order_number,status,payment_method,payment_status,subtotal_cents,delivery_fee_cents,total_cents,address,created_at,driver_id,food_pickup_confirmations(confirmed_at),food_order_items(name,quantity,options,notes,line_total_cents)",
          )
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.rpc("food_order_metrics", { p_restaurant_id: restaurantId }),
      ]);
    if (error) throw error;
    if (metricsError) throw metricsError;
    return Response.json({ orders: data || [], metrics });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request);
    const restaurantId = z
      .string()
      .uuid()
      .parse((await context.params).id);
    await restaurantForStaff(supabase, restaurantId, user.id);
    const input = z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(["accepted", "preparing", "ready", "rejected"]),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(await request.json());
    const { data: target } = await supabase
      .from("food_orders")
      .select("id")
      .eq("id", input.orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!target)
      throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
    const { data, error } = await supabase.rpc("transition_food_order", {
      p_order_id: input.orderId,
      p_actor_id: user.id,
      p_to_status: input.status,
      p_note: input.reason || null,
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
      input.orderId,
    );
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}
