import { z } from "zod";
import { jsonError } from "@/lib/backend/api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { MARKET_STORE_FIELDS, marketResponse, throwMarketError } from "@/lib/marketplace/customer-server";

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseAdminClient();
    const params = new URL(request.url).searchParams;
    const search = z.string().trim().max(80).parse(params.get("q") || "");
    const category = z.string().trim().max(80).parse(params.get("category") || "");
    let query = supabase.from("market_stores").select(MARKET_STORE_FIELDS).eq("status", "approved").eq("active", true);
    if (category) query = query.eq("category", category);
    if (search) query = query.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, error } = await query.order("name").order("id").limit(60);
    if (error) throwMarketError(error);
    if (!data?.length) return marketResponse({ stores: [] });
    const { data: availability, error: statusError } = await supabase.rpc("market_store_open_statuses", { p_store_ids: data.map(({ id }) => id) });
    if (statusError) throwMarketError(statusError);
    const openIds = new Set((availability as { id: string; is_open: boolean }[]).filter((row) => row.is_open).map(({ id }) => id));
    return marketResponse({ stores: data.map((store) => ({ ...store, open: openIds.has(store.id) })) });
  } catch (error) { return jsonError(error); }
}
