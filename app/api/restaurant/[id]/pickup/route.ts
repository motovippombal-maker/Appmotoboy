import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";
import { restaurantForStaff } from "@/lib/delivery/server";

export async function POST(
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
    const { orderId } = z
      .object({ orderId: z.string().uuid() })
      .parse(await request.json());
    const { data: order } = await supabase
      .from("food_orders")
      .select("id")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!order)
      throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
    const { error } = await supabase.rpc("confirm_food_pickup", {
      p_order_id: orderId,
      p_actor_id: user.id,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "PICKUP_CONFIRMATION_REJECTED");
      throw error;
    }
    await audit(
      supabase,
      user.id,
      "food_delivery.pickup_confirmed",
      "food_order",
      orderId,
    );
    return Response.json({ confirmed: true });
  } catch (error) {
    return jsonError(error);
  }
}
