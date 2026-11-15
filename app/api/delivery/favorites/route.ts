import { z } from "zod";
import { jsonError, requireUser } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { data, error } = await supabase
      .from("restaurant_favorites")
      .select("restaurant_id")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Response.json({
      ids: (data || []).map((item) => item.restaurant_id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { restaurantId } = z
      .object({ restaurantId: z.string().uuid() })
      .parse(await request.json());
    const { data: restaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .select("id")
      .eq("id", restaurantId)
      .eq("status", "approved")
      .maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant)
      return Response.json(
        {
          error: "RESTAURANT_NOT_FOUND",
          message: "Restaurante não encontrado.",
        },
        { status: 404 },
      );
    const { error } = await supabase
      .from("restaurant_favorites")
      .upsert({ customer_id: user.id, restaurant_id: restaurantId });
    if (error) throw error;
    return Response.json({ favorite: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const restaurantId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("restaurantId"));
    const { error } = await supabase
      .from("restaurant_favorites")
      .delete()
      .eq("customer_id", user.id)
      .eq("restaurant_id", restaurantId);
    if (error) throw error;
    return Response.json({ favorite: false });
  } catch (error) {
    return jsonError(error);
  }
}
