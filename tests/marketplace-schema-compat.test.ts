import assert from "node:assert/strict";
import test from "node:test";
import { isPreMarketplaceColumnMissing, readWithPreMarketplaceFallback } from "../lib/backend/marketplace-schema";

const missingColumn = { code: "42703", message: "column rides.market_order_id does not exist" };

test("legacy read is only allowed for the requested column and a physical PostgreSQL missing-column error", () => {
  assert.equal(isPreMarketplaceColumnMissing("market_order_id", missingColumn), true);
  assert.equal(isPreMarketplaceColumnMissing("market_order_id", { ...missingColumn, message: 'column "rides"."market_order_id" does not exist' }), true);
  assert.equal(isPreMarketplaceColumnMissing("market_dispatch_source", { ...missingColumn, message: "column ride_requests.market_dispatch_source does not exist" }), true);
  for (const error of [
    null,
    { code: "PGRST204", message: "Could not find the 'market_order_id' column of 'rides' in the schema cache" },
    { code: "42501", message: missingColumn.message },
    { ...missingColumn, message: "column rides.destination_lat does not exist" },
    { ...missingColumn, message: "column market_orders.market_order_id does not exist" },
    { ...missingColumn, message: "column rides.market_order_id_shadow does not exist" },
  ]) assert.equal(isPreMarketplaceColumnMissing("market_order_id", error), false);
  assert.equal(isPreMarketplaceColumnMissing("market_dispatch_source", missingColumn), false);
});

test("normal read errors propagate and legacy schema still returns ordinary rides", async () => {
  const denied = { data: null, error: { code: "42501", message: "permission denied" } };
  assert.equal(await readWithPreMarketplaceFallback("market_order_id",
    async () => denied, async () => assert.fail("Fallback must not retry an authorization error")), denied);
  const ordinary = { data: [{ id: "ordinary", status: "aceita" }], error: null };
  assert.equal(await readWithPreMarketplaceFallback("market_order_id",
    async () => ({ data: null, error: missingColumn }), async () => ordinary), ordinary);
});

test("a migration between queries cannot reveal the unscoped read", async () => {
  let currentReads = 0;
  const filtered = { data: [{ id: "ordinary" }], error: null };
  const unscoped = { data: [{ id: "commercial", market_order_id: "order" }], error: null };
  const result = await readWithPreMarketplaceFallback("market_order_id",
    async () => ++currentReads === 1 ? { data: null, error: missingColumn } : filtered,
    async () => unscoped);
  assert.equal(result, filtered);
  assert.equal(currentReads, 2);
});
