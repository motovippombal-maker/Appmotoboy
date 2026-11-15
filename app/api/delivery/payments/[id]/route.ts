import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { data, error } = await supabase.rpc("confirm_food_payment", {
      p_order_id: id,
      p_actor_id: user.id,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "PAYMENT_CONFIRMATION_REJECTED");
      throw error;
    }
    await audit(supabase, user.id, "food_payment.collected", "food_order", id);
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}
