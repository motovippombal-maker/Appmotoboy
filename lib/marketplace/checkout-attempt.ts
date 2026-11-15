import { cartEntryId, type MarketCart } from "./cart";

type AttemptStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Attempt = { key: string; cart: MarketCart };
export type MarketAccountScope = { id: string | null; generation: number };

export function nextMarketAccountScope(current: MarketAccountScope, id: string | null): MarketAccountScope {
  return current.id === id ? current : { id, generation: current.generation + 1 };
}

export function isPurchasedCart(current: MarketCart | null, purchased: MarketCart | null) {
  if (!current || !purchased || current.storeId !== purchased.storeId || current.entries.length !== purchased.entries.length) return false;
  const quantities = new Map(purchased.entries.map((entry) => [cartEntryId(entry), entry.quantity]));
  return current.entries.every((entry) => quantities.get(cartEntryId(entry)) === entry.quantity);
}

export function createMarketCheckoutAttempts() {
  const pending = new Map<string, Attempt>();
  const storageKey = (userId: string) => `moto-pombal:market-checkout:${userId}`;
  function read(userId: string, storage?: AttemptStore) {
    const known = pending.get(userId);
    if (known) return known.key;
    try { return storage?.getItem(storageKey(userId)) ?? null; } catch { return null; }
  }
  return {
    read,
    remember(userId: string, key: string, cart: MarketCart, storage?: AttemptStore) {
      if (pending.get(userId)?.key !== key) pending.set(userId, { key, cart });
      // Persist only the opaque key. The address and cart never leave memory.
      try { storage?.setItem(storageKey(userId), key); } catch { /* Same-tab memory still works. */ }
    },
    resolve(userId: string, key: string, storage?: AttemptStore, submittedCart?: MarketCart) {
      if (read(userId, storage) !== key) return null;
      const cart = submittedCart ?? pending.get(userId)?.cart ?? null;
      pending.delete(userId);
      try { storage?.removeItem(storageKey(userId)); } catch { /* Future lookup can still recover the same order. */ }
      return { cart };
    },
  };
}
