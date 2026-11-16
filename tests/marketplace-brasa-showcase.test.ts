import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRASA_SHOWCASE_CATALOG, BRASA_SHOWCASE_PATH } from "../lib/marketplace/brasa-showcase";

test("Brasa da Vila exposes a local showcase, without a live store or purchase", () => {
  const { store, checkoutAvailable } = BRASA_SHOWCASE_CATALOG;
  assert.equal(BRASA_SHOWCASE_PATH, "/compras/demonstracao/brasa-da-vila");
  assert.match(store.name, /demonstração/i);
  assert.equal(checkoutAvailable, false);
  assert.equal(store.open, false);
  assert.equal(store.address, "");
  assert.equal(store.prep_minutes, null);
  assert.equal(store.service_area_id, null);
  assert.deepEqual(store.hours, {});
});

test("the showcase preserves 8 categories and 42 products with valid scoped choices", () => {
  const { store, categories, products } = BRASA_SHOWCASE_CATALOG;
  assert.equal(categories.length, 8);
  assert.equal(products.length, 42);
  const ids = [store.id];
  const categoryIds = new Set(categories.map(({ id }) => id));
  ids.push(...categoryIds);
  let groups = 0;
  let options = 0;
  for (const product of products) {
    ids.push(product.id);
    assert.ok(product.category_id && categoryIds.has(product.category_id));
    assert.ok(Number.isSafeInteger(product.price_cents) && product.price_cents >= 0);
    for (const group of product.groups) {
      groups++;
      ids.push(group.id);
      assert.ok(group.id.startsWith(`${product.id}:`));
      assert.ok(Number.isSafeInteger(group.min_select) && Number.isSafeInteger(group.max_select));
      assert.ok(group.min_select >= 0 && group.min_select <= group.max_select);
      assert.ok(group.max_select >= 1 && group.max_select <= group.options.length);
      for (const option of group.options) {
        options++;
        ids.push(option.id);
        assert.ok(option.id.startsWith(`${group.id}:`));
        assert.ok(Number.isSafeInteger(option.price_cents) && option.price_cents >= 0);
      }
    }
  }
  assert.equal(categoryIds.size, 8);
  assert.equal(groups, 24);
  assert.equal(options, 56);
  assert.equal(new Set(ids).size, ids.length);
});

test("all store and product illustrations are local raster assets", () => {
  const { store, products } = BRASA_SHOWCASE_CATALOG;
  const images = [store.image_url, store.cover_url, ...products.map((item) => item.image_url)];
  assert.equal(new Set(images).size, 44);
  for (const path of images) {
    assert.ok(path);
    assert.match(path, /^\/marketplace-demo\/brasa-da-vila\/[a-z0-9-]+\.webp$/);
    const bytes = readFileSync(new URL(`../public${path}`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  }
});
