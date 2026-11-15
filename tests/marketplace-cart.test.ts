import assert from "node:assert/strict";
import test from "node:test";
import { addMarketEntry, cartEntryId, optionsInRange, type MarketCartEntry } from "../lib/marketplace/cart";

const store = { id: "store-a", slug: "loja-a" };
const otherStore = { id: "store-b", slug: "loja-b" };
const entry: MarketCartEntry = {
  productId: "product-a", quantity: 1, optionIds: ["cheese", "small"],
  title: "Sanduíche", optionsLabel: "Queijo, Pequeno", estimatedUnitCents: 1450,
};

test("trocar de loja preserva o carrinho até confirmação explícita", () => {
  const first = addMarketEntry(null, store, entry);
  assert.equal(first.state, "added");
  const blocked = addMarketEntry(first.cart, otherStore, { ...entry, productId: "product-b" });
  assert.equal(blocked.state, "replace");
  assert.deepEqual(blocked.cart, first.cart);
  const replaced = addMarketEntry(first.cart, otherStore, { ...entry, productId: "product-b" }, true);
  assert.equal(replaced.cart?.storeId, otherStore.id);
  assert.deepEqual(replaced.cart?.entries.map(({ productId }) => productId), ["product-b"]);
});

test("mesmo produto agrupa opções idênticas, mas não variações diferentes", () => {
  const first = addMarketEntry(null, store, entry);
  const second = addMarketEntry(first.cart, store, { ...entry, optionIds: ["small", "cheese"], quantity: 2 });
  assert.equal(second.cart?.entries[0].quantity, 3);
  const third = addMarketEntry(second.cart, store, { ...entry, optionIds: ["large", "cheese"] });
  assert.equal(third.cart?.entries.length, 2);
  assert.notEqual(cartEntryId(third.cart!.entries[0]), cartEntryId(third.cart!.entries[1]));
});

test("opção obrigatória, duplicata, grupo desconhecido e excesso são rejeitados", () => {
  const groups = [{ id: "size", name: "Tamanho", min_select: 1, max_select: 1,
    options: [{ id: "small", name: "Pequeno", price_cents: 0 }, { id: "large", name: "Grande", price_cents: 500 }] }];
  assert.equal(optionsInRange(groups, []), false);
  assert.equal(optionsInRange(groups, ["small", "small"]), false);
  assert.equal(optionsInRange(groups, ["small", "foreign"]), false);
  assert.equal(optionsInRange(groups, ["small", "large"]), false);
  assert.equal(optionsInRange(groups, ["small"]), true);
});
