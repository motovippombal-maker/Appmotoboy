import { z } from "zod";
import { ApiError, jsonError, requireUser } from "@/lib/backend/api";

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
    const input = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyMeters: z.number().min(0).max(5000).optional(),
      })
      .parse(await request.json());
    const { data: order, error: orderError } = await supabase
      .from("food_orders")
      .select("id")
      .eq("id", id)
      .eq("driver_id", user.id)
      .in("status", ["assigned", "at_restaurant", "picked_up", "on_the_way"])
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order)
      throw new ApiError(
        409,
        "Entrega não está ativa para este motorista.",
        "DELIVERY_NOT_ACTIVE",
      );
    const { error } = await supabase.from("food_delivery_locations").upsert(
      {
        order_id: id,
        driver_id: user.id,
        latitude: input.lat,
        longitude: input.lng,
        accuracy_meters: input.accuracyMeters ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "order_id" },
    );
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
