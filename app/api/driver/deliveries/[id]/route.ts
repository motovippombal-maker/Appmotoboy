import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { data, error } = await supabase.rpc("accept_food_delivery", {
      p_order_id: id,
      p_driver_id: user.id,
    });
    if (error) throw error;
    if (!data)
      throw new ApiError(
        409,
        "Entrega já atribuída ou motorista indisponível.",
        "DELIVERY_UNAVAILABLE",
      );
    await audit(supabase, user.id, "food_delivery.accepted", "food_order", id);
    return Response.json({ accepted: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { status } = z
      .object({
        status: z.enum([
          "at_restaurant",
          "picked_up",
          "on_the_way",
          "delivered",
        ]),
      })
      .parse(await request.json());
    const { data, error } = await supabase.rpc("transition_food_order", {
      p_order_id: id,
      p_actor_id: user.id,
      p_to_status: status,
      p_note: null,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "DELIVERY_TRANSITION_REJECTED");
      throw error;
    }
    await audit(supabase, user.id, `food_delivery.${status}`, "food_order", id);
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { reason } = z
      .object({ reason: z.string().trim().min(3).max(300) })
      .parse(await request.json());
    const { data, error } = await supabase.rpc("release_food_delivery", {
      p_order_id: id,
      p_driver_id: user.id,
      p_reason: reason,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "DELIVERY_RELEASE_REJECTED");
      throw error;
    }
    await audit(supabase, user.id, "food_delivery.released", "food_order", id, {
      reason,
    });
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}
