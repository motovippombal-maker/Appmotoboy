import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { liveOfferPush, marketPushPointer } from "../lib/push/delivery-policy";

test("offer Push expires with the actual pending offer and cannot change driver or ride", () => {
  const clock = Date.parse("2026-11-15T10:00:00Z");
  const offer = { id: randomUUID(), ride_id: randomUUID(), driver_id: randomUUID(), status: "pending", expires_at: "2026-11-15T10:00:30Z" };
  const pointer = { offerId: offer.id, rideId: offer.ride_id, userId: offer.driver_id };
  assert.deepEqual(liveOfferPush(pointer, offer, clock + 8_999), { ttl: 21, rideId: offer.ride_id, expiresAt: offer.expires_at });
  assert.equal(liveOfferPush(pointer, offer, clock + 60_000), null); // first retry after default 30s deadline
  assert.equal(liveOfferPush(pointer, offer, clock + 29_500), null);
  assert.equal(liveOfferPush({ ...pointer, userId: randomUUID() }, offer, clock), null);
  assert.equal(liveOfferPush({ ...pointer, rideId: randomUUID() }, offer, clock), null);
  assert.equal(liveOfferPush(pointer, { ...offer, status: "accepted" }, clock), null);
  assert.equal(liveOfferPush(pointer, { ...offer, status: "declined" }, clock), null);
  assert.equal(liveOfferPush(pointer, null, clock), null);
});

test("market Push exposes only an authorized-page pointer, no person details or arbitrary target", () => {
  const orderId = randomUUID();
  const data = { orderId, audience: "customer", url: "https://outro.test", recipientName: "Sintético" };
  assert.deepEqual(marketPushPointer("market.order_update", data), { orderId, audience: "customer" });
  assert.deepEqual(marketPushPointer("market.delivery_exception", { orderId }), { orderId, audience: "customer" });
  assert.deepEqual(marketPushPointer("market.order_update", { ...data, audience: "guest" }), {});
  assert.deepEqual(marketPushPointer("market.order_update", { ...data, orderId: "https://outro.test" }), {});
});

test("service worker suppresses expired offers and allows only known internal order links", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const displayed: unknown[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, callback: (event: unknown) => void) => handlers.set(type, callback),
    registration: { showNotification: async (...args: unknown[]) => { displayed.push(args); } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, URL, Date });
  const run = async (name: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> | undefined;
    handlers.get(name)?.({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
    await work;
  };
  await run("push", { data: { json: () => ({ data: { type: "ride.offer", rideId: randomUUID(), expiresAt: new Date(Date.now() - 60_000).toISOString() } }) } });
  assert.equal(displayed.length, 0);
  await run("push", { data: { json: () => ({ data: { type: "ride.offer", rideId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() } }) } });
  assert.equal(displayed.length, 1);
  const orderId = randomUUID();
  const click = (data: unknown) => run("notificationclick", { notification: { data, close() {} } });
  await click({ type: "market.order_update", audience: "customer", orderId, url: "https://outro.test" });
  await click({ type: "market.order_update", audience: "merchant", orderId });
  await click({ type: "market.order_update", audience: "admin", orderId });
  await click({ type: "market.order_update", audience: "customer", orderId: "//outro.test" });
  assert.deepEqual(opened, [`/compras/pedidos/${orderId}`, "/comerciante", "/admin/marketplace", "/?open=notifications"]);
});
