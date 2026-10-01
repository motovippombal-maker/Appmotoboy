import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Ride } from "../hooks/use-moto-vip";
import { ConnectivityManager } from "../lib/offline/connectivity";
import { RoadGraph, type RoadPackage } from "../lib/offline/road-graph";
import { OFFLINE_REGION } from "../lib/offline/region";
import { makeOfflineRide, type OfflineEvent, type OfflineRidePackage } from "../lib/offline/ride-store";
import { syncOfflineRide, type SyncStore } from "../lib/offline/ride-sync";
import { selectDriverRide } from "../lib/driver/ride-authority";

test("grafo local respeita mão única, volta permitida e limita distância de entrada", () => {
  const graph = new RoadGraph({ regionId: "test", version: "1", bounds: [-1, -1, 1, 1], source: "test", generatedAt: "2026-10-01",
    nodes: { 1: [0, 0], 2: [0, 0.001], 3: [0.001, 0.001], 4: [0.001, 0] },
    roads: [
      { id: 1, name: "Leste", highway: "residential", oneway: 1, nodes: [1, 2] },
      { id: 2, name: "Norte", highway: "residential", oneway: 0, nodes: [2, 3] },
      { id: 3, name: "Oeste", highway: "residential", oneway: 0, nodes: [3, 4] },
      { id: 4, name: "Sul", highway: "residential", oneway: 0, nodes: [4, 1] },
    ],
  });
  const forward = graph.route({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, "pickup");
  const reverse = graph.route({ lat: 0, lng: 0.001 }, { lat: 0, lng: 0 }, "trip");
  assert.ok(forward && reverse);
  assert.equal(forward.phase, "pickup");
  assert.ok(forward.distanceMeters < reverse.distanceMeters);
  assert.ok(reverse.steps.length >= 2);
  assert.equal(graph.route({ lat: 3, lng: 3 }, { lat: 0, lng: 0 }, "trip"), null);
});

test("pacote real da região encontra rota sem rede", async () => {
  const bytes = await readFile("public/offline/ribeira-do-pombal-ba-2026-10-01-1.json");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), OFFLINE_REGION.checksumSha256);
  const data = JSON.parse(bytes.toString("utf8")) as RoadPackage;
  const graph = new RoadGraph(data);
  const route = graph.route({ lat: -10.8422, lng: -38.5299 }, { lat: -10.8389, lng: -38.5318 }, "trip");
  assert.ok(route);
  assert.ok(route.distanceMeters > 300 && route.distanceMeters < 2000);
  assert.ok(route.steps.length > 0);
  assert.equal(JSON.parse(route.geometry).type, "LineString");
});

test("conexão usa histerese e exige estabilidade para recuperar", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const manager = new ConnectivityManager();
  let healthy = false;
  globalThis.fetch = async () => healthy ? Response.json({ ok: true }) : Promise.reject(new Error("offline"));
  (globalThis as unknown as { window: Window }).window = { dispatchEvent: () => true } as unknown as Window;
  try {
    await manager.check(); assert.equal(manager.current, "ONLINE");
    await manager.check(); assert.equal(manager.current, "DEGRADED");
    await manager.check(); await manager.check(); assert.equal(manager.current, "OFFLINE");
    healthy = true;
    await manager.check(); assert.equal(manager.current, "RECOVERING");
    await manager.check(); assert.equal(manager.current, "ONLINE");
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { window: Window }).window = originalWindow;
  }
});

function fixture(events: OfflineEvent[]): OfflineRidePackage {
  const ride = { id: "ride-1", driver_id: "driver-1", passenger_id: "passenger-1", status: "motorista_a_caminho",
    origin_address: "Origem", origin_lat: -10.84, origin_lng: -38.53, destination_address: "Destino", destination_lat: -10.83, destination_lng: -38.52,
    distance_meters: 1000, duration_seconds: 180, fare_cents: 1200, payment_method: "cash", payment_status: "aguardando_pagamento", created_at: "2026-10-01T12:00:00Z" } as Ride;
  return { ...makeOfflineRide(ride, "driver-1", null, null, true), navigationState: "finalizada", offlineEvents: events };
}

test("fila confirma as três etapas na ordem e não repete transições", async () => {
  const events: OfflineEvent[] = ["ARRIVED_AT_PICKUP", "RIDE_STARTED", "RIDE_COMPLETED"].map((type, index) => ({
    eventId: `event-${index}`, rideId: "ride-1", type: type as OfflineEvent["type"], timestamp: `2026-10-01T12:0${index}:00Z`, coordinates: null, retryCount: 0, status: "pending" }));
  let data: OfflineRidePackage | null = fixture(events);
  let serverStatus = "motorista_a_caminho";
  const transitions: string[] = [];
  const store: SyncStore = {
    get: async () => data,
    mark: async (_rideId, eventId, status) => { if (data) data.offlineEvents = data.offlineEvents.map((event) => event.eventId === eventId ? { ...event, status } : event); },
    clear: async () => { data = null; },
  };
  const api = {
    getSnapshot: async () => ({ ride: serverStatus === "finalizada" ? null : { id: "ride-1", driver_id: "driver-1", status: serverStatus, fare_pricing_mode: "region" } as Ride,
      completedRide: serverStatus === "finalizada" ? { id: "ride-1", driver_id: "driver-1", status: serverStatus, fare_pricing_mode: "region" } as Ride : null }),
    transition: async (_rideId: string, status: string) => { transitions.push(status); serverStatus = status; },
  };
  const result = await syncOfflineRide("driver-1", api, store);
  assert.equal(result.confirmed, 3);
  assert.deepEqual(transitions, ["motorista_chegou", "em_corrida", "finalizada"]);
  assert.equal(data, null);
  await syncOfflineRide("driver-1", api, store);
  assert.equal(transitions.length, 3);
});

test("queda após aceitar sincroniza deslocamento antes da chegada", async () => {
  const event: OfflineEvent = { eventId: "event-en-route", rideId: "ride-1", type: "RIDE_EN_ROUTE",
    timestamp: "2026-10-01T12:00:00Z", coordinates: null, retryCount: 0, status: "pending" };
  const data = fixture([event]);
  data.navigationState = "motorista_a_caminho";
  let serverStatus = "aceita";
  const transitions: string[] = [];
  const result = await syncOfflineRide("driver-1", {
    getSnapshot: async () => ({ ride: { id: "ride-1", driver_id: "driver-1", status: serverStatus } as Ride, completedRide: null }),
    transition: async (_rideId, status) => { transitions.push(status); serverStatus = status; },
  }, {
    get: async () => data,
    mark: async (_id, _eventId, status) => { event.status = status; },
    clear: async () => undefined,
  });
  assert.equal(result.confirmed, 1);
  assert.deepEqual(transitions, ["motorista_a_caminho"]);
  assert.equal(event.status, "synced");
});

test("cancelamento confirmado remove a corrida local em qualquer etapa antes do embarque", async () => {
  for (const state of ["aceita", "motorista_a_caminho", "motorista_chegou"]) {
    const data = fixture([]);
    data.navigationState = state;
    data.ride.status = state;
    assert.equal(selectDriverRide({ serverRide: data.ride, offlinePackage: data,
      serverVerified: true, serverReachable: true })?.id, data.ride.id);
    assert.equal(selectDriverRide({ serverRide: null, offlinePackage: data,
      serverVerified: true, serverReachable: true }), null);
    assert.equal(selectDriverRide({ serverRide: null, offlinePackage: data,
      cancelledRideId: data.ride.id, serverVerified: true, serverReachable: false }), null);
    assert.equal(selectDriverRide({ serverRide: null, offlinePackage: data,
      serverVerified: false, serverReachable: true }), null);
  }
});

test("sem rede a corrida local permanece; ao reconectar o servidor prevalece", () => {
  const data = fixture([]);
  data.navigationState = "motorista_a_caminho";
  assert.equal(selectDriverRide({ serverRide: null, offlinePackage: data,
    serverVerified: true, serverReachable: false })?.id, data.ride.id);
  assert.equal(selectDriverRide({ serverRide: null, offlinePackage: data,
    serverVerified: true, serverReachable: true }), null);
});

test("estado confirmado do servidor prevalece sobre evento local ainda pendente", () => {
  const data = fixture([{ eventId: "pending", rideId: "ride-1", type: "ARRIVED_AT_PICKUP",
    timestamp: "2026-10-01T12:00:00Z", coordinates: null, retryCount: 0, status: "pending" }]);
  data.navigationState = "motorista_chegou";
  const serverRide = { ...data.ride, status: "motorista_a_caminho" } as Ride;
  assert.equal(selectDriverRide({ serverRide, offlinePackage: data,
    serverVerified: true, serverReachable: true })?.status, "motorista_a_caminho");
  assert.equal(selectDriverRide({ serverRide, offlinePackage: data,
    serverVerified: false, serverReachable: false })?.status, "motorista_chegou");
});

test("sincronização descarta etapas locais quando passageiro cancelou no servidor", async () => {
  const data = fixture([{ eventId: "e1", rideId: "ride-1", type: "ARRIVED_AT_PICKUP",
    timestamp: "2026-10-01T12:00:00Z", coordinates: null, retryCount: 0, status: "pending" }]);
  let stored: OfflineRidePackage | null = data;
  let transitions = 0;
  const result = await syncOfflineRide("driver-1", {
    getSnapshot: async () => ({ ride: null, completedRide: null, cancelledRide: { id: "ride-1" } }),
    transition: async () => { transitions += 1; },
  }, {
    get: async () => stored,
    mark: async () => undefined,
    clear: async () => { stored = null; },
  });
  assert.equal(result.cancelled, true);
  assert.equal(stored, null);
  assert.equal(transitions, 0);
});

test("estado já confirmado pelo servidor não é enviado de novo", async () => {
  const event: OfflineEvent = { eventId: "event-1", rideId: "ride-1", type: "RIDE_STARTED", timestamp: "2026-10-01T12:00:00Z", coordinates: null, retryCount: 0, status: "pending" };
  const data = fixture([event]);
  data.navigationState = "em_corrida";
  let sent = 0;
  const result = await syncOfflineRide("driver-1", {
    getSnapshot: async () => ({ ride: { id: "ride-1", driver_id: "driver-1", status: "em_corrida" } as Ride, completedRide: null }),
    transition: async () => { sent += 1; },
  }, { get: async () => data, mark: async (_id, _eventId, status) => { event.status = status; }, clear: async () => undefined });
  assert.equal(result.confirmed, 1);
  assert.equal(sent, 0);
});

test("tarifa variável não é finalizada automaticamente após viagem offline", async () => {
  const event: OfflineEvent = { eventId: "event-complete", rideId: "ride-1", type: "RIDE_COMPLETED", timestamp: "2026-10-01T12:00:00Z", coordinates: null, retryCount: 0, status: "pending" };
  const data = fixture([event]);
  let sent = 0;
  const result = await syncOfflineRide("driver-1", {
    getSnapshot: async () => ({ ride: { id: "ride-1", driver_id: "driver-1", status: "em_corrida", fare_pricing_mode: "distance" } as Ride, completedRide: null }),
    transition: async () => { sent += 1; },
  }, { get: async () => data, mark: async () => undefined, clear: async () => undefined });
  assert.match(result.conflict || "", /tarifa variável/i);
  assert.equal(sent, 0);
  assert.equal(data.offlineEvents[0].status, "pending");
});
