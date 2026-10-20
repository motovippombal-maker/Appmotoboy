import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDriverLocationEvent, mergeDriverLocationSnapshot } from "../lib/tracking/driver-location-state";
import { startSessionRecovery } from "../lib/auth/session-recovery";
import { bookingActionContext } from "./helpers/passenger-booking-actions";

const ride = { id: "ride-a", driver_id: "driver-a", status: "motorista_a_caminho" };
const point = (updatedAt: string, rideId = ride.id) => ({ lat: -10.8, lng: -38.5, rideId, updatedAt });

test("HTTP atrasado não desfaz posição mais recente recebida por Realtime", () => {
  const initial = mergeDriverLocationSnapshot(null, ride, point("2026-10-20T10:00:00Z"));
  const realtime = mergeDriverLocationEvent(initial, ride.id, ride.driver_id, point("2026-10-20T10:00:10Z"));
  const olderHttp = mergeDriverLocationSnapshot(realtime, ride, point("2026-10-20T10:00:05Z"));
  assert.equal(olderHttp?.location, realtime?.location);
  assert.equal(mergeDriverLocationSnapshot(realtime, ride, null)?.location, realtime?.location);
});

test("trocar de motorista descarta GPS antigo mesmo se seu timestamp for maior", () => {
  const previous = mergeDriverLocationSnapshot(null, ride, point("2026-10-20T10:00:10Z"));
  const replacement = { ...ride, driver_id: "driver-b" };
  const next = mergeDriverLocationSnapshot(previous, replacement, point("2026-10-20T10:00:05Z"));
  assert.equal(next?.driverId, "driver-b");
  assert.equal(next?.location?.updatedAt, "2026-10-20T10:00:05Z");
  assert.equal(mergeDriverLocationEvent(next, ride.id, ride.driver_id, point("2026-10-20T10:00:20Z")), next);
  assert.equal(mergeDriverLocationSnapshot(previous, replacement, null)?.location, null);
});

test("outra corrida, ausência de atribuição e cancelamento limpam localização", () => {
  const current = mergeDriverLocationSnapshot(null, ride, point("2026-10-20T10:00:10Z"));
  assert.equal(mergeDriverLocationSnapshot(current, { ...ride, id: "ride-b" }, null)?.location, null);
  assert.equal(mergeDriverLocationSnapshot(current, { ...ride, driver_id: null }, null), null);
  assert.equal(mergeDriverLocationSnapshot(current, { ...ride, status: "cancelada" }, null), null);
  assert.equal(mergeDriverLocationSnapshot(current, null, null), null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise<void>((done) => setImmediate(done));

test("origem confirmada no mapa vence estimativa anterior que termina depois", async () => {
  const originA = { address: "Origem A", lat: -10.8, lng: -38.5 };
  const originB = { address: "Origem B", lat: -10.81, lng: -38.51 };
  const destination = { address: "Destino", lat: -10.82, lng: -38.52 };
  const oldQuote = deferred<{ origin: typeof originA; destination: typeof destination }>();
  const newQuote = deferred<{ origin: typeof originA; destination: typeof destination }>();
  let calls = 0;
  const values: Record<string, unknown> = {
    originPoint: originA, originAddress: originA.address, destinationPoint: destination,
    destinationAddress: destination.address, selectedQuickPlace: null, isDelivery: true,
    mapPicker: "origin", quoteRequestRef: { current: 0 }, busy: false, estimate: null,
    backend: {
      estimateRide: () => (++calls === 1 ? oldQuote.promise : newQuote.promise),
      findNearbyDrivers: async () => ({ drivers: [], arrivalSeconds: null }),
    },
  };
  let state = values;
  for (const name of ["Busy", "Estimate", "OriginPoint", "OriginAddress", "DestinationPoint", "DestinationAddress", "NearbyDrivers", "NearbyArrivalSeconds", "DestinationSearchOpen", "SheetMode", "Notice", "LocationStatus", "MapPicker"])
    values[`set${name}`] = (value: unknown) => { state[name[0].toLowerCase() + name.slice(1)] = value; };
  const actions = bookingActionContext(values);
  state = actions.values;
  const earlierRequest = actions.calculate();
  actions.confirmMapAddress(originB);
  assert.equal(calls, 2);
  assert.equal(state.originAddress, originB.address);
  newQuote.resolve({ origin: originB, destination });
  await flush();
  oldQuote.resolve({ origin: originA, destination });
  await earlierRequest;
  assert.equal(state.originAddress, originB.address);
  assert.equal((state.estimate as { origin: typeof originA }).origin.address, originB.address);
  assert.equal(state.busy, false);
});

function recoveryFixture() {
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const navigator = { onLine: true };
  let tick = () => {};
  let intervalMs = 0;
  let stopped = false;
  return {
    browser, document, navigator,
    environment: {
      window: browser, document, navigator,
      every: (callback: () => void, milliseconds: number) => {
        tick = callback;
        intervalMs = milliseconds;
        return () => { stopped = true; };
      },
    },
    tick: () => tick(), intervalMs: () => intervalMs, stopped: () => stopped,
  };
}

test("sessão sem perfil repete sincronização pelo timer e pelo online nativo", async () => {
  const fixture = recoveryFixture();
  let requests = 0;
  const stop = startSessionRecovery({ role: undefined, realtimeConnected: false, environment: fixture.environment,
    synchronize: async () => { requests += 1; } });
  assert.equal(fixture.intervalMs(), 10_000);
  fixture.tick();
  await flush();
  fixture.navigator.onLine = false;
  fixture.tick();
  assert.equal(requests, 1);
  fixture.navigator.onLine = true;
  fixture.browser.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(requests, 2);
  stop();
  assert.equal(fixture.stopped(), true);
  fixture.browser.dispatchEvent(new Event("online"));
  fixture.tick();
  assert.equal(requests, 2);
});

test("recovery respeita aba oculta e não duplica requisição em andamento", async () => {
  const fixture = recoveryFixture();
  const pending = deferred<void>();
  let requests = 0;
  const stop = startSessionRecovery({ role: "passenger", realtimeConnected: true, environment: fixture.environment,
    synchronize: () => { requests += 1; return pending.promise; } });
  assert.equal(fixture.intervalMs(), 30_000);
  fixture.document.hidden = true;
  fixture.browser.dispatchEvent(new Event("online"));
  fixture.tick();
  assert.equal(requests, 0);
  fixture.document.hidden = false;
  fixture.document.dispatchEvent(new Event("visibilitychange"));
  fixture.browser.dispatchEvent(new Event("focus"));
  fixture.tick();
  assert.equal(requests, 1);
  pending.resolve();
  await flush();
  fixture.tick();
  assert.equal(requests, 2);
  stop();
});
