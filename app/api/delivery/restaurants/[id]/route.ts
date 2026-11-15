import { z } from "zod";
import { ApiError, jsonError } from "@/lib/backend/api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isWithinRestaurantHours } from "@/lib/delivery/opening-hours";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const supabase = createSupabaseAdminClient();
    const { data: restaurant, error } = await supabase
      .from("restaurants")
      .select(
        "id,name,description,cuisine,address,city,state,logo_url,cover_url,preparation_minutes,minimum_order_cents,opens_at,closes_at,accepting_orders",
      )
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle();
    if (error) throw error;
    if (!restaurant)
      throw new ApiError(
        404,
        "Restaurante não encontrado.",
        "RESTAURANT_NOT_FOUND",
      );
    const [categories, products] = await Promise.all([
      supabase
        .from("menu_categories")
        .select("id,name,sort_order")
        .eq("restaurant_id", id)
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("menu_products")
        .select(
          "id,category_id,name,description,image_url,price_cents,available,sort_order,menu_option_groups(id,name,min_choices,max_choices,sort_order,menu_options(id,name,price_cents,available,sort_order))",
        )
        .eq("restaurant_id", id)
        .eq("archived", false)
        .order("sort_order"),
    ]);
    if (categories.error) throw categories.error;
    if (products.error) throw products.error;
    return Response.json({
      restaurant: {
        ...restaurant,
        open:
          restaurant.accepting_orders &&
          isWithinRestaurantHours(restaurant.opens_at, restaurant.closes_at),
      },
      categories: categories.data || [],
      products: products.data || [],
    });
  } catch (error) {
    return jsonError(error);
  }
}
