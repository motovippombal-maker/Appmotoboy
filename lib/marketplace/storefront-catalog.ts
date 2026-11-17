import type { MarketProduct } from "./customer-contract";

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
