"use client";

import type { ManagementData, ManageStore } from "@/lib/marketplace/management-view";
import { storefrontProducts } from "@/lib/marketplace/storefront-catalog";
import { StoreSimulation } from "./store-simulation";

// Public option queries use the ID as a tiebreaker for the merchant's display order.
function byChoiceOrder(a: { sort_order: number; id: string }, b: { sort_order: number; id: string }) {
  return a.sort_order - b.sort_order || a.id.localeCompare(b.id);
}

export function MerchantStorePreview({ data, store }: { data: ManagementData; store: ManageStore }) {
  const categories = data.categories.filter((item) => item.active).slice(0, 200);
  const products = storefrontProducts(categories, data.products.filter((item) => item.active).slice(0, 500),
    data.groups.filter((item) => item.active).sort(byChoiceOrder), data.options.filter((item) => item.active).sort(byChoiceOrder));
  return <div className="market-shell market-shell-storefront"><div className="market-main">
    <StoreSimulation key={store.id} mode="preview" catalog={{
      store: { ...store, open: data.openNow }, categories, products, checkoutAvailable: false,
    }} />
  </div></div>;
}
