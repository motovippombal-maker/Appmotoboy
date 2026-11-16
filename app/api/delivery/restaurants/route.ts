import { jsonError } from "@/lib/backend/api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isWithinRestaurantHours } from "@/lib/delivery/opening-hours";

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseAdminClient();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
    const page = Math.max(
      0,
      Math.min(
        1000,
        Number.parseInt(url.searchParams.get("page") || "0", 10) || 0,
      ),
    );
    let builder = supabase
      .from("restaurants")
      .select(
        "id,name,description,cuisine,address,city,state,logo_url,cover_url,preparation_minutes,minimum_order_cents,opens_at,closes_at,accepting_orders",
        { count: "exact" },
      )
      .eq("status", "approved")
      .order("name")
      .range(page * 20, page * 20 + 19);
    if (query)
      builder = builder.or(
        `name.ilike.%${query.replace(/[%(),]/g, "")}%,cuisine.ilike.%${query.replace(/[%(),]/g, "")}%`,
      );
    const [{ data, count, error }, matches] = await Promise.all([
      builder,
      query
        ? supabase
            .from("menu_products")
            .select(
              "id,name,price_cents,restaurant_id,restaurants!inner(id,name,status)",
            )
            .ilike("name", `%${query.replace(/[%_,]/g, "")}%`)
            .eq("archived", false)
            .eq("available", true)
            .eq("restaurants.status", "approved")
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (error?.code === "PGRST205" || matches.error?.code === "PGRST205") {
      return Response.json({ restaurants: [], products: [], count: 0, page });
    }
    if (error) throw error;
    if (matches.error) throw matches.error;
    const ids = (data || []).map((restaurant) => restaurant.id);
    const reviews = ids.length
      ? await supabase
          .from("food_reviews")
          .select("restaurant_id,restaurant_score")
          .in("restaurant_id", ids)
      : { data: [], error: null };
    if (reviews.error) throw reviews.error;
    const scores = new Map<string, { count: number; total: number }>();
    for (const review of reviews.data || []) {
      const current = scores.get(review.restaurant_id) || {
        count: 0,
        total: 0,
      };
      scores.set(review.restaurant_id, {
        count: current.count + 1,
        total: current.total + review.restaurant_score,
      });
    }
    return Response.json({
      restaurants: (data || []).map((restaurant) => ({
        ...restaurant,
        open:
          restaurant.accepting_orders &&
          isWithinRestaurantHours(restaurant.opens_at, restaurant.closes_at),
        rating: scores.has(restaurant.id)
          ? Number(
              (
                scores.get(restaurant.id)!.total /
                scores.get(restaurant.id)!.count
              ).toFixed(1),
            )
          : null,
        ratingCount: scores.get(restaurant.id)?.count || 0,
      })),
      products: matches.data || [],
      count: count || 0,
      page,
    });
  } catch (error) {
    return jsonError(error);
  }
}
