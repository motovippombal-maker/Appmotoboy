import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

let database;

async function value(sql, params = []) {
  const result = await database.query(sql, params);
  return result.rows[0];
}

async function seedPassenger() {
  const id = randomUUID();
  await database.query("insert into auth.users(id) values ($1)", [id]);
  return id;
}

async function seedDriver() {
  const id = randomUUID();
  const vehicleId = randomUUID();
  await database.query("insert into auth.users(id, raw_user_meta_data) values ($1, $2)", [id, { role: "driver" }]);
  await database.query("update public.drivers set approval_status = 'approved', online = true, available = true where profile_id = $1", [id]);
  await database.query("insert into public.vehicles(id, driver_id, brand, model, color, plate) values ($1, $2, 'Honda', 'CG', 'Preta', $3)", [vehicleId, id, `T${id.slice(0, 6)}`]);
  await database.query("insert into public.driver_locations(driver_id, latitude, longitude, updated_at) values ($1, -10.8373, -38.5357, now())", [id]);
  return { id, vehicleId };
}

async function createRide(passengerId, options = {}) {
  const id = randomUUID();
  await database.query(`
    insert into public.rides(
      id, passenger_id, driver_id, vehicle_id, status,
      origin_address, origin_lat, origin_lng,
      destination_address, destination_lat, destination_lng,
      distance_meters, duration_seconds, fare_cents,
      estimated_distance_meters, estimated_duration_seconds, estimated_fare_cents,
      fare_pricing_mode, started_at
    ) values (
      $1, $2, $3, $4, $5,
      'Origem', -10.8373, -38.5357,
      'Destino', -10.8422, -38.5299,
      1500, 600, 700,
      1500, 600, 700,
      'region', $6
    )
  `, [
    id,
    passengerId,
    options.driverId || null,
    options.vehicleId || null,
    options.status || "procurando_motorista",
    options.startedAt || null,
  ]);
  return id;
}

async function createOffer(rideId, driverId, expired = false) {
  await database.query(
    "insert into public.ride_requests(ride_id, driver_id, expires_at) values ($1, $2, $3)",
    [rideId, driverId, new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString()],
  );
}

async function acceptRide(rideId, driverId) {
  return (await value("select public.accept_ride($1, $2) as accepted", [rideId, driverId])).accepted;
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

  const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
  const migrations = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await database.exec(await readFile(path.join(migrationsDirectory, migration), "utf8"));
  }
});

after(async () => {
  await database.close();
});

test("1. passageiro solicita e motorista aceita normalmente", async () => {
  const passengerId = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passengerId);
  await createOffer(rideId, driver.id);

  assert.equal(await acceptRide(rideId, driver.id), true);
  assert.deepEqual(await value("select status, driver_id from public.rides where id = $1", [rideId]), { status: "aceita", driver_id: driver.id });
  assert.equal((await value("select status from public.ride_requests where ride_id = $1 and driver_id = $2", [rideId, driver.id])).status, "accepted");
});

test("2. todas as ofertas expiram e a busca termina", async () => {
  const passengerId = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passengerId);
  await createOffer(rideId, driver.id, true);
  await database.query("insert into public.passenger_locations(passenger_id, ride_id, latitude, longitude) values ($1, $2, -10.8373, -38.5357)", [passengerId, rideId]);

  assert.equal((await value("select public.expire_ride_searches($1) as count", [rideId])).count, 1);
  const ride = await value("select status, cancellation_reason from public.rides where id = $1", [rideId]);
  assert.equal(ride.status, "cancelada");
  assert.match(ride.cancellation_reason, /Nenhum motorista/);
  assert.equal((await value("select status from public.ride_requests where ride_id = $1", [rideId])).status, "expired");
  assert.equal((await value("select ride_id from public.passenger_locations where passenger_id = $1", [passengerId])).ride_id, null);
  assert.equal((await value("select count(*)::integer as count from public.notifications where user_id = $1 and type = 'ride.no_driver_found'", [passengerId])).count, 1);
});

test("3. nova tentativa não herda ofertas da busca encerrada", async () => {
  const passengerId = await seedPassenger();
  const firstDriver = await seedDriver();
  const firstRideId = await createRide(passengerId);
  await createOffer(firstRideId, firstDriver.id, true);
  await database.query("select public.expire_ride_searches($1)", [firstRideId]);

  const nextDriver = await seedDriver();
  const nextRideId = await createRide(passengerId);
  await createOffer(nextRideId, nextDriver.id);
  assert.equal(await acceptRide(nextRideId, nextDriver.id), true);
  assert.equal((await value("select status from public.rides where id = $1", [firstRideId])).status, "cancelada");
  assert.equal((await value("select status from public.rides where id = $1", [nextRideId])).status, "aceita");
});

test("4. cancelamento atrasado da corrida A não afeta a corrida B", async () => {
  const firstPassenger = await seedPassenger();
  const secondPassenger = await seedPassenger();
  const driver = await seedDriver();
  const firstRideId = await createRide(firstPassenger);
  await createOffer(firstRideId, driver.id);
  assert.equal(await acceptRide(firstRideId, driver.id), true);
  await database.query("select public.cancel_ride($1, $2, 'cancelamento inicial')", [firstRideId, firstPassenger]);

  const secondRideId = await createRide(secondPassenger);
  await createOffer(secondRideId, driver.id);
  assert.equal(await acceptRide(secondRideId, driver.id), true);
  await database.query("select public.cancel_ride($1, $2, 'retry atrasado')", [firstRideId, firstPassenger]);

  assert.deepEqual(await value("select status, driver_id from public.rides where id = $1", [secondRideId]), { status: "aceita", driver_id: driver.id });
  assert.equal((await value("select available from public.drivers where profile_id = $1", [driver.id])).available, false);
  assert.equal((await value("select ride_id from public.driver_locations where driver_id = $1", [driver.id])).ride_id, secondRideId);
});

test("5. dois motoristas concorrentes: somente um aceite vence", async () => {
  const passengerId = await seedPassenger();
  const firstDriver = await seedDriver();
  const secondDriver = await seedDriver();
  const rideId = await createRide(passengerId);
  await createOffer(rideId, firstDriver.id);
  await createOffer(rideId, secondDriver.id);

  const results = await Promise.all([
    acceptRide(rideId, firstDriver.id),
    acceptRide(rideId, secondDriver.id),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal((await value("select count(*)::integer as count from public.ride_requests where ride_id = $1 and status = 'accepted'", [rideId])).count, 1);
  assert.ok([firstDriver.id, secondDriver.id].includes((await value("select driver_id from public.rides where id = $1", [rideId])).driver_id));
});

test("6. cancelamento duplicado não repete efeitos colaterais", async () => {
  const passengerId = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passengerId);
  await createOffer(rideId, driver.id);
  await database.query("insert into public.passenger_locations(passenger_id, ride_id, latitude, longitude) values ($1, $2, -10.8373, -38.5357)", [passengerId, rideId]);
  assert.equal(await acceptRide(rideId, driver.id), true);

  const first = await value("select (public.cancel_ride($1, $2, 'duplicado')).status as status", [rideId, passengerId]);
  const second = await value("select (public.cancel_ride($1, $2, 'duplicado')).status as status", [rideId, passengerId]);
  assert.equal(first.status, "cancelada");
  assert.equal(second.status, "cancelada");
  assert.equal((await value("select count(*)::integer as count from public.ride_history where ride_id = $1 and to_status = 'cancelada'", [rideId])).count, 1);
  assert.equal((await value("select count(*)::integer as count from public.audit_logs where entity_id = $1 and action = 'ride.cancelada'", [rideId])).count, 1);
  assert.equal((await value("select ride_id from public.passenger_locations where passenger_id = $1", [passengerId])).ride_id, null);
});

test("7. início e finalização duplicados permanecem idempotentes", async () => {
  const passengerId = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passengerId, { driverId: driver.id, vehicleId: driver.vehicleId, status: "motorista_chegou" });
  await database.query("update public.drivers set available = false where profile_id = $1", [driver.id]);
  await database.query("update public.driver_locations set ride_id = $1 where driver_id = $2", [rideId, driver.id]);
  await database.exec("update public.system_settings set value = value || '{\"configured\": true}'::jsonb where key = 'fare'");

  assert.equal((await value("select (public.start_ride($1, $2)).status as status", [rideId, driver.id])).status, "em_corrida");
  assert.equal((await value("select (public.start_ride($1, $2)).status as status", [rideId, driver.id])).status, "em_corrida");
  assert.equal((await value("select (public.finish_ride($1, $2)).status as status", [rideId, driver.id])).status, "finalizada");
  assert.equal((await value("select (public.finish_ride($1, $2)).status as status", [rideId, driver.id])).status, "finalizada");

  assert.equal((await value("select count(*)::integer as count from public.ride_history where ride_id = $1 and to_status = 'em_corrida'", [rideId])).count, 1);
  assert.equal((await value("select count(*)::integer as count from public.ride_history where ride_id = $1 and to_status = 'finalizada'", [rideId])).count, 1);
  assert.equal((await value("select count(*)::integer as count from public.payments where ride_id = $1", [rideId])).count, 1);
  assert.equal((await value("select trips_count from public.drivers where profile_id = $1", [driver.id])).trips_count, 1);
  assert.equal((await value("select ride_id from public.driver_locations where driver_id = $1", [driver.id])).ride_id, null);
});
