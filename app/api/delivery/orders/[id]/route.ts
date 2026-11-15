import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { data, error } = await supabase
      .from("food_orders")
      .select(
        "*,food_order_items(id,name,quantity,unit_price_cents,options,notes,line_total_cents),food_order_events(from_status,to_status,note,created_at),food_reviews(restaurant_score,delivery_score),restaurants(name,address,preparation_minutes),drivers(profiles(full_name,avatar_url),vehicles(brand,model,color,plate))",
      )
      .eq("id", id)
      .eq("customer_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
    let deliveryLocation = null;
    if (
      data.driver_id &&
      ["assigned", "at_restaurant", "picked_up", "on_the_way"].includes(
        data.status,
      )
    ) {
      const location = await supabase
        .from("food_delivery_locations")
        .select("latitude,longitude,accuracy_meters,updated_at")
        .eq("order_id", id)
        .maybeSingle();
      if (location.error) throw location.error;
      deliveryLocation = location.data;
    }
    return Response.json({ order: { ...data, deliveryLocation } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { reason } = z
      .object({ reason: z.string().trim().min(3).max(300) })
      .parse(await request.json());
    const { data, error } = await supabase.rpc("transition_food_order", {
      p_order_id: id,
      p_actor_id: user.id,
      p_to_status: "cancelled",
      p_note: reason,
    });
    if (error) {
      if (error.code === "P0001")
        throw new ApiError(409, error.message, "ORDER_TRANSITION_REJECTED");
      throw error;
    }
    await audit(supabase, user.id, "food_order.cancelled", "food_order", id, {
      reason,
    });
    return Response.json({ order: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return jsonError(error);
  }
}
