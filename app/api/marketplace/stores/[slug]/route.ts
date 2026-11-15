import { ApiError, jsonError } from "@/lib/backend/api";
import { marketplaceOperationsEnabled } from "@/lib/backend/marketplace-operation-mode";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { marketSlug, type MarketGroup, type MarketOption } from "@/lib/marketplace/customer-contract";
import { MARKET_STORE_FIELDS, marketResponse, storeAvailability, throwMarketError } from "@/lib/marketplace/customer-server";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const slug = marketSlug.parse((await params).slug);
    const supabase = createSupabaseAdminClient();
    const { data: store, error } = await supabase.from("market_stores").select(MARKET_STORE_FIELDS).eq("slug", slug).eq("status", "approved").eq("active", true).maybeSingle();
    if (error) throwMarketError(error);
    if (!store) throw new ApiError(404, "Loja não encontrada.", "MARKET_STORE_NOT_FOUND");
    const [categories, products, groups, options, availableStore, checkoutAvailable] = await Promise.all([
      supabase.from("market_categories").select("id,name").eq("store_id", store.id).eq("active", true).order("sort_order").order("name").limit(200),
      supabase.from("market_products").select("id,category_id,name,description,image_url,price_cents,stock_quantity").eq("store_id", store.id).eq("active", true).order("sort_order").order("name").limit(500),
      supabase.from("market_option_groups").select("id,product_id,name,min_select,max_select").eq("store_id", store.id).eq("active", true).order("sort_order").order("id").limit(1000),
      supabase.from("market_options").select("id,group_id,name,price_cents").eq("store_id", store.id).eq("active", true).order("sort_order").order("id").limit(1000),
      storeAvailability(supabase, store),
      marketplaceOperationsEnabled(supabase),
    ]);
    for (const result of [categories, products, groups, options]) if (result.error) throwMarketError(result.error);
    const categoryIds = new Set(categories.data?.map(({ id }) => id));
    const groupOptions = new Map<string, MarketOption[]>();
    for (const { group_id, ...option } of options.data ?? []) {
      groupOptions.set(group_id, [...(groupOptions.get(group_id) ?? []), option]);
    }
    const productGroups = new Map<string, MarketGroup[]>();
    for (const { product_id, ...group } of groups.data ?? []) {
      productGroups.set(product_id, [...(productGroups.get(product_id) ?? []), { ...group, options: groupOptions.get(group.id) ?? [] }]);
    }
    return marketResponse({
      store: availableStore, categories: categories.data ?? [], checkoutAvailable,
      products: (products.data ?? []).filter((p) => p.category_id === null || categoryIds.has(p.category_id)).map(({ stock_quantity, ...product }) => {
        const groups = productGroups.get(product.id) ?? [];
        return { ...product, available: (stock_quantity === null || stock_quantity > 0) && groups.every((item) => item.options.length >= item.min_select), groups };
      }),
    });
  } catch (error) { return jsonError(error); }
}
