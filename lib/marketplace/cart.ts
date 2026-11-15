import type { MarketCartLine, MarketGroup } from "./customer-contract";

export type MarketCartEntry = MarketCartLine & { title: string; optionsLabel: string; estimatedUnitCents: number };
export type MarketCart = { storeId: string; slug: string; entries: MarketCartEntry[] };

export function optionsInRange(groups: MarketGroup[], ids: string[]) {
  const selected = new Set(ids);
  if (selected.size !== ids.length) return false;
  for (const group of groups) {
    const count = group.options.filter(({ id }) => selected.delete(id)).length;
    if (count < group.min_select || count > group.max_select) return false;
  }
  return selected.size === 0;
}

export function cartEntryId(entry: MarketCartLine) {
  return [entry.productId, ...[...entry.optionIds].sort()].join(":");
}

export function addMarketEntry(cart: MarketCart | null, store: { id: string; slug: string }, entry: MarketCartEntry, replace = false) {
  if (cart && cart.storeId !== store.id && !replace) return { state: "replace" as const, cart };
  const next = cart?.storeId === store.id ? [...cart.entries] : [];
  const index = next.findIndex((item) => cartEntryId(item) === cartEntryId(entry));
  if (index < 0 && next.length >= 30) return { state: "limit" as const, cart };
  if ((index < 0 ? 0 : next[index].quantity) + entry.quantity > 99) return { state: "limit" as const, cart };
  if (index >= 0) next[index] = { ...entry, quantity: next[index].quantity + entry.quantity };
  else next.push(entry);
  return { state: "added" as const, cart: { storeId: store.id, slug: store.slug, entries: next } };
}
