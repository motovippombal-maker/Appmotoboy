import type { MarketCategory, MarketGroup, MarketOption, MarketProduct } from "./customer-contract";

type ProductRow = Omit<MarketProduct, "available" | "groups"> & { stock_quantity: number | null };
type GroupRow = Omit<MarketGroup, "options"> & { product_id: string };

export function storefrontProducts(categories: MarketCategory[], products: ProductRow[], groups: GroupRow[], options: (MarketOption & { group_id: string })[]): MarketProduct[] {
  const categoryIds = new Set(categories.map(({ id }) => id));
  const groupOptions = new Map<string, MarketOption[]>();
  for (const { group_id, id, name, price_cents } of options) {
    const list = groupOptions.get(group_id) ?? [];
    list.push({ id, name, price_cents });
    groupOptions.set(group_id, list);
  }
  const productGroups = new Map<string, MarketGroup[]>();
  for (const { product_id, id, name, min_select, max_select } of groups) {
    const list = productGroups.get(product_id) ?? [];
    list.push({ id, name, min_select, max_select, options: groupOptions.get(id) ?? [] });
    productGroups.set(product_id, list);
  }
  return products.filter((p) => p.category_id === null || categoryIds.has(p.category_id)).map((p) => {
    const choices = productGroups.get(p.id) ?? [];
    return {
      id: p.id, name: p.name, category_id: p.category_id, description: p.description, image_url: p.image_url, price_cents: p.price_cents,
      groups: choices, available: (p.stock_quantity === null || p.stock_quantity > 0) && choices.every((group) => group.options.length >= group.min_select),
    };
  });
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function filterStorefrontProducts(products: MarketProduct[], categoryId: string, query: string): MarketProduct[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);

  return products.filter((product) => {
    if (categoryId && product.category_id !== categoryId) return false;
    if (!terms.length) return true;
    const searchable = normalizeSearch(`${product.name} ${product.description ?? ""}`);
    return terms.every((term) => searchable.includes(term));
  });
}
