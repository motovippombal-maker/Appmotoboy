import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { ApiError } from "../lib/backend/errors";
import { calculateRoute } from "../lib/backend/routing";
import { mapViewportKey, shouldAutoFitViewport } from "../lib/map/viewport";
import {
  etaTarget,
  newerLocation,
  normalizeRealtimeStatus,
  shouldRecalculateEta,
  shouldRefreshNearbyDrivers,
  shouldResynchronizeRealtime,
  shouldSendLocationUpdate,
  trackingPhase,
  type TimedLocation,
} from "../lib/tracking/realtime";

let database: PGlite;

async function seedPassenger() {
  const id = randomUUID();
  await database.query("insert into auth.users(id) values ($1)", [id]);
  return id;
}

async function seedDriver(online = false) {
  const id = randomUUID();
  const vehicleId = randomUUID();
  await database.query(
    "insert into auth.users(id, raw_user_meta_data) values ($1, $2)",
    [id, { role: "driver" }],
  );
  await database.query(
    "update public.drivers set approval_status = 'approved', online = $2, available = $2 where profile_id = $1",
    [id, online],
  );
  await database.query(
    "insert into public.vehicles(id, driver_id, brand, model, color, plate) values ($1, $2, 'Honda', 'CG', 'Preta', $3)",
    [vehicleId, id, `R${id.slice(0, 6)}`],
  );
  return { id, vehicleId };
}

before(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  await database.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid
      language sql stable as $$ select null::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create publication supabase_realtime;
  `);
  const directory = path.join(process.cwd(), "supabase", "migrations");
  const migrations = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await database.exec(await readFile(path.join(directory, migration), "utf8"));
  }
});

after(async () => database.close());

test("1. passageiro recebe sinal para atualizar quando motorista entra online", async () => {
  const driver = await seedDriver(false);
  await database.query(
    "update public.drivers set online = true, available = true where profile_id = $1",
    [driver.id],
  );
  const result = await database.query<{ count: number }>(
    "select count(*)::integer as count from public.drivers where profile_id = $1 and online and available",
    [driver.id],
  );
  assert.equal(result.rows[0].count, 1);
  assert.equal(
    shouldRefreshNearbyDrivers({
      role: "passenger",
      hasActiveRide: false,
      driverOnline: true,
      driverAvailable: true,
    }),
    true,
  );
});

test("2. motorista offline deixa de ser elegível e sinaliza atualização", async () => {
  const driver = await seedDriver(true);
  await database.query(
    "update public.drivers set online = false, available = false where profile_id = $1",
    [driver.id],
  );
  const result = await database.query<{ count: number }>(
    "select count(*)::integer as count from public.drivers where profile_id = $1 and online and available",
    [driver.id],
  );
  assert.equal(result.rows[0].count, 0);
  assert.equal(
    shouldRefreshNearbyDrivers({
      role: "passenger",
      hasActiveRide: false,
      driverOnline: false,
      driverAvailable: false,
    }),
    true,
  );
});

test("3. aceite vincula motorista e o retira de novas ofertas", async () => {
  const passengerId = await seedPassenger();
  const driver = await seedDriver(true);
  const rideId = randomUUID();
  await database.query(
    `insert into public.rides(
      id, passenger_id, status, origin_address, origin_lat, origin_lng,
      destination_address, destination_lat, destination_lng,
      distance_meters, duration_seconds, fare_cents
    ) values ($1, $2, 'procurando_motorista', 'Origem', -10.8, -38.5,
      'Destino', -10.9, -38.6, 1000, 600, 700)`,
    [rideId, passengerId],
  );
  await database.query(
    "insert into public.driver_locations(driver_id, latitude, longitude, updated_at) values ($1, -10.81, -38.51, now())",
    [driver.id],
  );
  await database.query(
    "insert into public.ride_requests(ride_id, driver_id, expires_at) values ($1, $2, now() + interval '1 minute')",
    [rideId, driver.id],
  );
  const accepted = await database.query<{ accepted: boolean }>(
    "select public.accept_ride($1, $2) as accepted",
    [rideId, driver.id],
  );
  const state = await database.query<{
    available: boolean;
    ride_id: string;
  }>(
    "select d.available, l.ride_id from public.drivers d join public.driver_locations l on l.driver_id = d.profile_id where d.profile_id = $1",
    [driver.id],
  );
  assert.equal(accepted.rows[0].accepted, true);
  assert.deepEqual(state.rows[0], { available: false, ride_id: rideId });
});

const currentLocation: TimedLocation = {
  lat: -10.81,
  lng: -38.51,
  updatedAt: "2026-09-29T02:10:10.000Z",
  rideId: "ride-a",
};

test("4. passageiro aceita uma nova posição válida da corrida vinculada", () => {
  const incoming = {
    ...currentLocation,
    lat: -10.811,
    updatedAt: "2026-09-29T02:10:11.000Z",
  };
  assert.equal(newerLocation(currentLocation, incoming, "ride-a"), incoming);
});

test("5. posição antiga não sobrescreve posição nova nem no banco", async () => {
  const driver = await seedDriver(true);
  const newerAt = "2026-09-29T02:10:10.000Z";
  const olderAt = "2026-09-29T02:10:05.000Z";
  await database.query(
    "select public.upsert_driver_location_if_newer($1, null, -10.82, -38.52, 8, null, null, $2)",
    [driver.id, newerAt],
  );
  await database.query(
    "select public.upsert_driver_location_if_newer($1, null, -10.80, -38.50, 8, null, null, $2)",
    [driver.id, olderAt],
  );
  const location = await database.query<{
    latitude: number;
    longitude: number;
    updated_at: Date;
  }>(
    "select latitude, longitude, updated_at from public.driver_locations where driver_id = $1",
    [driver.id],
  );
  assert.equal(location.rows[0].latitude, -10.82);
  assert.equal(location.rows[0].longitude, -38.52);
  assert.equal(new Date(location.rows[0].updated_at).toISOString(), newerAt);
});

test("6. queda do Realtime não permanece visualmente conectada", () => {
  assert.equal(normalizeRealtimeStatus("CLOSED"), "disconnected");
  assert.equal(normalizeRealtimeStatus("CHANNEL_ERROR"), "error");
});

test("7. reconexão solicita ressincronização com o backend", () => {
  assert.equal(shouldResynchronizeRealtime("disconnected", "connected"), true);
  assert.equal(shouldResynchronizeRealtime("connected", "connected"), false);
});

test("8. antes do embarque o ETA aponta motorista para origem", () => {
  assert.deepEqual(
    etaTarget("motorista_a_caminho", {
      origin_lat: -10.8,
      origin_lng: -38.5,
      destination_lat: -10.9,
      destination_lng: -38.6,
    }),
    { phase: "pickup", lat: -10.8, lng: -38.5 },
  );
});

test("9. após iniciar a corrida o ETA aponta para o destino", () => {
  assert.deepEqual(
    etaTarget("em_corrida", {
      origin_lat: -10.8,
      origin_lng: -38.5,
      destination_lat: -10.9,
      destination_lng: -38.6,
    }),
    { phase: "trip", lat: -10.9, lng: -38.6 },
  );
});

test("10. falha do OSRM não impede uma nova posição nem fabrica ETA", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    await assert.rejects(
      calculateRoute(currentLocation, { lat: -10.8, lng: -38.5 }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "ROUTING_UNAVAILABLE",
    );
    const incoming = {
      ...currentLocation,
      lat: -10.812,
      updatedAt: "2026-09-29T02:10:12.000Z",
    };
    assert.equal(newerLocation(currentLocation, incoming, "ride-a"), incoming);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11. throttle bloqueia GPS excessivo e recalcula ETA de forma controlada", () => {
  const previous = {
    lat: -10.81,
    lng: -38.51,
    accuracyMeters: 8,
    timestamp: 1_000,
  };
  assert.equal(
    shouldSendLocationUpdate(previous, { ...previous, timestamp: 3_000 }, true),
    false,
  );
  assert.equal(
    shouldRecalculateEta(
      { phase: "pickup", location: currentLocation, calculatedAt: 1_000 },
      "pickup",
      currentLocation,
      5_000,
    ),
    false,
  );
});

test("12. coordenada inválida é descartada", () => {
  assert.equal(
    newerLocation(currentLocation, {
      ...currentLocation,
      lat: Number.NaN,
      updatedAt: "2026-09-29T02:10:12.000Z",
    }),
    currentLocation,
  );
});

test("13. corrida cancelada encerra fase específica de tracking", () => {
  assert.equal(trackingPhase("cancelada"), null);
});

test("14. corrida finalizada encerra ETA e recálculos", () => {
  assert.equal(trackingPhase("finalizada"), null);
});

test("15. atualização do marcador não solicita fitBounds após zoom manual", () => {
  const viewport = mapViewportKey({
    origin: { lat: -10.8, lng: -38.5 },
    destination: { lat: -10.9, lng: -38.6 },
    route: [
      [-10.8, -38.5],
      [-10.9, -38.6],
    ],
  });
  assert.equal(shouldAutoFitViewport(viewport, viewport), false);
});
