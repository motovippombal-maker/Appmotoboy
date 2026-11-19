import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketProduct } from "../lib/marketplace/customer-contract";
import { filterStorefrontProducts, storefrontProducts } from "../lib/marketplace/storefront-catalog";

const product = (id: string, category_id: string | null, name: string, description: string | null, available = true): MarketProduct => ({
  id, category_id, name, description, image_url: null, price_cents: 1_500, available, groups: [],
});

const products = [
  product("1", "burgers", "Queijo na brasa", "Pão brioche com cebola caramelizada e molho da casa"),
  product("2", "sides", "Batata crocante", "Com molho da casa"),
  product("3", "burgers", "Vegetal da brasa", "Pão brioche com cebola", false),
  product("4", null, "Café", null),
];

test("prévia e vitrine pública exibem o mesmo catálogo vendável sem expor o estoque", () => {
  const rows = products.map((p, i) => ({ ...p, stock_quantity: i === 2 ? 0 : null }));
  const group = { id: "g", product_id: "1", name: "Pão", min_select: 1, max_select: 1 };
  const category = { id: "burgers", name: "Hambúrgueres" };
  const visible = storefrontProducts([category], rows, [group], []);
  assert.deepEqual(visible.map((p) => [p.id, p.available]), [["1", false], ["3", false], ["4", true]]);
  assert.equal("stock_quantity" in visible[0], false);
  const withChoice = storefrontProducts([category], rows, [group], [{ id: "op", group_id: "g", name: "Brioche", price_cents: 150 }]);
  assert.equal(withChoice[0].available, true);
  assert.deepEqual(withChoice[0].groups[0].options, [{ id: "op", name: "Brioche", price_cents: 150 }]);
});

test("categoria vazia e consulta em branco exibem todos os produtos na ordem original", () => {
  assert.deepEqual(filterStorefrontProducts(products, "", "  \n\t "), products);
  assert.deepEqual(filterStorefrontProducts(products, "burgers", ""), [products[0], products[2]]);
  assert.deepEqual(filterStorefrontProducts(products, "inexistente", ""), []);
});

test("a busca ignora maiúsculas, acentos e espaços e exige cada termo no nome ou na descrição", () => {
  assert.deepEqual(filterStorefrontProducts(products, "", "  BRASA  pão\tCEBOLA "), [products[0], products[2]]);
  assert.deepEqual(filterStorefrontProducts(products, "burgers", "caramelizada queijo"), [products[0]]);
  assert.deepEqual(filterStorefrontProducts(products, "sides", "brasa molho"), []);
  assert.deepEqual(filterStorefrontProducts(products, "", "CAFE\u0301"), [products[3]]);
  assert.deepEqual(filterStorefrontProducts(products, "", "cafe ausente"), []);
});

test("a busca não altera ordem, identidade dos produtos nem disponibilidade", () => {
  const result = filterStorefrontProducts(products, "burgers", "brasa");
  assert.equal(result[0], products[0]);
  assert.equal(result[1], products[2]);
  assert.equal(result[1].available, false);
  assert.deepEqual(products.map(({ id, available }) => ({ id, available })), [
    { id: "1", available: true }, { id: "2", available: true }, { id: "3", available: false }, { id: "4", available: true },
  ]);
});
