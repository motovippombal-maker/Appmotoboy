import { jsonError, requireUser } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser(request);
    const url = new URL(request.url);
    const featuredOnly = url.searchParams.get("featured") === "true";
    let query = supabase
      .from("quick_places")
      .select("id,name,address,latitude,longitude,category,icon,color,active,featured,sort_order,updated_at")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (featuredOnly) query = query.eq("featured", true).limit(6);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ places: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}
