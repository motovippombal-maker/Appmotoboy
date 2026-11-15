import { z } from "zod";
import { ApiError, jsonError, requireUser } from "@/lib/backend/api";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const input = z
      .object({
        orderId: z.string().uuid(),
        restaurantScore: z.number().int().min(1).max(5),
        deliveryScore: z.number().int().min(1).max(5).nullable(),
        comment: z.string().trim().max(500).optional(),
      })
      .parse(await request.json());
    const { data: order, error: orderError } = await supabase
      .from("food_orders")
      .select("id,restaurant_id,driver_id,status")
      .eq("id", input.orderId)
      .eq("customer_id", user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.status !== "delivered")
      throw new ApiError(
        409,
        "Apenas pedidos entregues podem ser avaliados.",
        "REVIEW_NOT_ALLOWED",
      );
    const { data, error } = await supabase
      .from("food_reviews")
      .insert({
        order_id: input.orderId,
        customer_id: user.id,
        restaurant_id: order.restaurant_id,
        driver_id: order.driver_id,
        restaurant_score: input.restaurantScore,
        delivery_score: order.driver_id ? input.deliveryScore : null,
        comment: input.comment || null,
      })
      .select("order_id,restaurant_score,delivery_score")
      .single();
    if (error?.code === "23505")
      throw new ApiError(409, "Pedido já avaliado.", "REVIEW_ALREADY_EXISTS");
    if (error) throw error;
    return Response.json({ review: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
