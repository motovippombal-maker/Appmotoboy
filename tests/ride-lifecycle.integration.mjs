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
  await database.query("insert into public.vehicles(id, driver_id, brand, model, color, plate) values ($1, $2, 'Honda', 'CG', 'Preta', $3)", [vehicleId, id, `T${id.slice(0, 6)}`]);
  await database.query("update public.drivers set approval_status = 'approved', online = true, available = true where profile_id = $1", [id]);
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
  await database.query("update public.drivers set online = false, available = false");
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

test("3a. rodízio oferece um por vez e ignora distância ou ausência de GPS", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  const third = await seedDriver();
  await database.query("update public.driver_locations set updated_at = now() - interval '1 hour' where driver_id = $1", [first.id]);
  await database.query("update public.driver_locations set latitude = -10.8700 where driver_id = $1", [second.id]);
  await database.query("update public.driver_locations set latitude = -10.8380 where driver_id = $1", [third.id]);

  const firstRide = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [firstRide])).driver, first.id);
  assert.equal((await value("select count(*)::integer as count from public.ride_requests where ride_id = $1", [firstRide])).count, 1);
  assert.equal(await acceptRide(firstRide, first.id), true);

  const secondRide = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [secondRide])).driver, second.id);
  assert.equal((await value("select count(*)::integer as count from public.ride_requests where ride_id = $1", [secondRide])).count, 1);
  assert.notEqual(second.id, third.id);
});

test("3a-1. mudança de status não deixa motorista com corrida ativa disponível", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const driver = await seedDriver();
  const rideId = await createRide(await seedPassenger());
  await createOffer(rideId, driver.id);
  assert.equal(await acceptRide(rideId, driver.id), true);

  const activeStatus = (await value(
    "select public.set_driver_online_status($1, true, -10.84, -38.54, 12, now()) as status", [driver.id],
  )).status;
  assert.deepEqual(activeStatus, { online: true, available: false, activeRideId: rideId });
  assert.deepEqual(await value(
    "select ride_id, latitude, longitude from public.driver_locations where driver_id = $1", [driver.id],
  ), { ride_id: rideId, latitude: -10.84, longitude: -38.54 });
  await assert.rejects(
    database.query("select public.set_driver_online_status($1, false)", [driver.id]),
    /Conclua ou cancele a corrida/,
  );
  assert.deepEqual(await value(
    "select online, available from public.drivers where profile_id = $1", [driver.id],
  ), { online: true, available: false });

  const passengerId = (await value("select passenger_id from public.rides where id = $1", [rideId])).passenger_id;
  await database.query("select public.cancel_ride($1, $2, 'teste')", [rideId, passengerId]);
  const offlineStatus = (await value(
    "select public.set_driver_online_status($1, false) as status", [driver.id],
  )).status;
  assert.deepEqual(offlineStatus, { online: false, available: false, activeRideId: null });
});

test("3a-2. retorno online após pausa recoloca o motorista na fila", async () => {
  const driver = await seedDriver();
  await database.query("select public.set_driver_queue_paused($1, true)", [driver.id]);
  await database.query("select public.set_driver_online_status($1, false)", [driver.id]);
  const status = (await value(
    "select public.set_driver_online_status($1, true) as status", [driver.id],
  )).status;
  assert.equal(status.online, true);
  assert.equal(status.available, true);
  assert.equal((await value(
    "select queue_paused from public.drivers where profile_id = $1", [driver.id],
  )).queue_paused, false);
});

test("3b. recusa passa a oferta ao próximo motorista elegível", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  const rideId = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [rideId])).driver, first.id);
  await database.query("update public.ride_requests set status = 'declined' where ride_id = $1 and driver_id = $2", [rideId, first.id]);
  assert.equal((await value("select public.expire_ride_searches($1) as changed", [rideId])).changed, 1);
  assert.equal((await value("select driver_id from public.ride_requests where ride_id = $1 and status = 'pending'", [rideId])).driver_id, second.id);
});

test("3c. cancelamento do passageiro devolve prioridade reservada ao motorista", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  await seedDriver();
  const firstRide = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [firstRide])).driver, first.id);
  assert.equal(await acceptRide(firstRide, first.id), true);
  await database.query("select public.cancel_ride($1, $2, 'encerrar teste do rodizio')", [firstRide, (await value("select passenger_id from public.rides where id = $1", [firstRide])).passenger_id]);
  await database.query("update public.drivers set available = true where profile_id = $1", [first.id]);
  const secondRide = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [secondRide])).driver, first.id);
});

test("3d. offline, suspenso, fora do turno e ocupado não entram no rodízio", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const offline = await seedDriver();
  const suspended = await seedDriver();
  const offShift = await seedDriver();
  const busy = await seedDriver();
  const eligible = await seedDriver();
  await database.query("update public.drivers set online = false where profile_id = $1", [offline.id]);
  await database.query("update public.profiles set blocked = true where id = $1", [suspended.id]);
  await database.query("update public.drivers set on_shift = false where profile_id = $1", [offShift.id]);
  await database.query("update public.drivers set available = false where profile_id = $1", [busy.id]);
  const rideId = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [rideId])).driver, eligible.id);
});

test("3e. oferta aberta passa ao próximo quando o motorista fica offline", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  const rideId = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [rideId])).driver, first.id);
  await database.query("update public.drivers set online = false, available = false, on_shift = false where profile_id = $1", [first.id]);
  await database.query("select public.expire_ride_searches($1)", [rideId]);
  assert.equal((await value("select status from public.ride_requests where ride_id = $1 and driver_id = $2", [rideId, first.id])).status, "expired");
  assert.equal((await value("select driver_id from public.ride_requests where ride_id = $1 and status = 'pending'", [rideId])).driver_id, second.id);
});

test("3f. expiração passa ao próximo sem antecipar sua posição na fila", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  const rideId = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [rideId])).driver, first.id);
  await database.query("update public.ride_requests set expires_at = now() - interval '1 second' where ride_id = $1 and driver_id = $2", [rideId, first.id]);
  assert.equal((await value("select public.expire_ride_searches($1) as changed", [rideId])).changed, 1);
  assert.equal((await value("select driver_id from public.ride_requests where ride_id = $1 and status = 'pending'", [rideId])).driver_id, second.id);
  assert.equal((await value("select status from public.rides where id = $1", [rideId])).status, "procurando_motorista");
});

test("3g. Minha Fila usa a ordem do despacho, pausa e volta ao fim sem GPS", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  const third = await seedDriver();
  await database.query("delete from public.driver_locations where driver_id = $1", [second.id]);
  let queue = (await value("select public.driver_queue_snapshot($1) as queue", [second.id])).queue;
  assert.deepEqual([queue.status, queue.position, queue.ahead, queue.total], ["queued", 2, 1, 3]);
  assert.ok(queue.enteredAt);
  assert.ok(queue.updatedAt);
  assert.deepEqual(Object.keys(queue).sort(), ["ahead", "enteredAt", "position", "returnPolicy", "status", "total", "updatedAt"]);
  assert.equal((await value("select has_function_privilege('authenticated', 'public.driver_queue_snapshot(uuid)', 'execute') as allowed")).allowed, false);

  queue = (await value("select public.set_driver_queue_paused($1, true) as queue", [first.id])).queue;
  assert.equal(queue.status, "paused");
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [second.id])).queue.position, 1);
  const ride = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [ride])).driver, second.id);
  await database.query("update public.ride_requests set status = 'declined' where ride_id = $1 and driver_id = $2", [ride, second.id]);

  queue = (await value("select public.set_driver_queue_paused($1, false) as queue", [first.id])).queue;
  assert.deepEqual([queue.status, queue.position, queue.ahead], ["queued", 3, 2]);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [third.id])).queue.position, 2);
  await database.query("update public.drivers set online = false, available = false, on_shift = false where profile_id = $1", [second.id]);
  await database.query("update public.drivers set online = true, available = true, on_shift = true where profile_id = $1", [second.id]);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [second.id])).queue.position, 3);
});

test("3h. avisos de 3º, 2º e 1º são emitidos uma vez por avanço", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const drivers = [await seedDriver(), await seedDriver(), await seedDriver(), await seedDriver()];
  const target = drivers[3].id;
  const observe = async () => (await value("select public.observe_driver_queue($1) as queue", [target])).queue;
  assert.equal((await observe()).position, 4);
  assert.equal((await observe()).notificationId, null);
  for (const [index, position] of [[0, 3], [1, 2], [2, 1]]) {
    await database.query("select public.set_driver_queue_paused($1, true)", [drivers[index].id]);
    const advanced = await observe();
    assert.equal(advanced.position, position);
    assert.ok(advanced.notificationId);
    assert.equal((await observe()).notificationId, null);
  }
  const alerts = await database.query("select title from public.notifications where user_id = $1 and type like 'queue.%' order by created_at, id", [target]);
  assert.equal(alerts.rows.length, 4);
  assert.deepEqual(new Set(alerts.rows.map((alert) => alert.title)), new Set(["Você entrou na fila", "Fila avançou", "Fique atento", "Você é o próximo!"]));
  await database.query("update public.system_settings set value = jsonb_set(value, '{pause_return}', '\"original\"'::jsonb) where key = 'dispatch'");
  await database.query("select public.set_driver_queue_paused($1, false)", [drivers[0].id]);
  assert.equal((await observe()).position, 2);
  await database.query("select public.set_driver_queue_paused($1, true)", [drivers[0].id]);
  assert.equal((await observe()).notificationId, null);
  assert.equal((await value("select count(*)::integer as count from public.notifications where user_id = $1 and type like 'queue.%'", [target])).count, 4);
  await database.query("update public.system_settings set value = jsonb_set(value, '{pause_return}', '\"end\"'::jsonb) where key = 'dispatch'");
});

test("3i. oferta e corrida suspendem a posição; cancelamento do passageiro a restaura", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const first = await seedDriver();
  const second = await seedDriver();
  await database.query("select public.observe_driver_queue($1)", [first.id]);
  const ride = await createRide(await seedPassenger());
  assert.equal((await value("select public.dispatch_next_offer($1) as driver", [ride])).driver, first.id);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [first.id])).queue.status, "offer");
  await database.query("select public.observe_driver_queue($1)", [first.id]);
  await assert.rejects(() => database.query("select public.set_driver_queue_paused($1, true)", [first.id]), /Responda à oferta/);
  assert.equal(await acceptRide(ride, first.id), true);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [first.id])).queue.status, "on_ride");
  await database.query("select public.observe_driver_queue($1)", [first.id]);
  await database.query("select public.cancel_ride($1, $2, 'encerrar teste')", [ride, (await value("select passenger_id from public.rides where id = $1", [ride])).passenger_id]);
  const returned = (await value("select public.driver_queue_snapshot($1) as queue", [first.id])).queue;
  assert.deepEqual([returned.status, returned.position, returned.ahead], ["queued", 1, 0]);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [second.id])).queue.position, 2);
  await database.query("select public.observe_driver_queue($1)", [first.id]);
  assert.equal((await value("select title from public.notifications where user_id = $1 and type = 'queue.joined' order by created_at desc, id desc limit 1", [first.id])).title, "Você voltou para a fila");
});

test("3j. ADM desliga a fila: todos os elegíveis recebem juntos, sem raio, e só um assume", async () => {
  await database.query("update public.drivers set online = false, available = false");
  await database.query("update public.system_settings set value = jsonb_set(value, '{mode}', '\"broadcast\"'::jsonb) where key = 'dispatch'");
  try {
    const first = await seedDriver();
    const second = await seedDriver();
    const third = await seedDriver();
    const offline = await seedDriver();
    await database.query("delete from public.driver_locations where driver_id = $1", [first.id]);
    await database.query("update public.driver_locations set latitude = -11.5000 where driver_id = $1", [second.id]);
    await database.query("update public.drivers set online = false where profile_id = $1", [offline.id]);
    const firstOrder = (await value("select dispatch_order from public.drivers where profile_id = $1", [first.id])).dispatch_order;
    const ride = await createRide(await seedPassenger());

    assert.ok([first.id, second.id, third.id].includes((await value("select public.dispatch_next_offer($1) as driver", [ride])).driver));
    const offered = await database.query("select driver_id from public.ride_requests where ride_id = $1 and status = 'pending'", [ride]);
    assert.deepEqual(new Set(offered.rows.map((row) => row.driver_id)), new Set([first.id, second.id, third.id]));
    assert.equal((await value("select count(*)::integer as count from public.ride_requests where ride_id = $1 and driver_id = $2", [ride, offline.id])).count, 0);
    assert.equal(await acceptRide(ride, first.id), true);
    assert.equal(await acceptRide(ride, second.id), false);
    assert.equal((await value("select dispatch_order from public.drivers where profile_id = $1", [first.id])).dispatch_order, firstOrder);
    assert.equal((await value("select count(*)::integer as count from public.ride_requests where ride_id = $1 and status = 'accepted'", [ride])).count, 1);
  } finally {
    await database.query("update public.system_settings set value = jsonb_set(value, '{mode}', '\"round_robin\"'::jsonb) where key = 'dispatch'");
  }
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
  assert.equal((await value("select available from public.drivers where profile_id = $1", [driver.id])).available, true);
  assert.equal((await value("select public.driver_queue_snapshot($1) as queue", [driver.id])).queue.status, "queued");
});

test("8. cancelamento antes do aceite expira oferta e não prende motorista", async () => {
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, driver.id);
  const cancelled = await value("select (public.cancel_ride($1, $2, 'desisti')).status as status", [rideId, passenger]);
  assert.equal(cancelled.status, "cancelada");
  assert.equal((await value("select status from public.ride_requests where ride_id = $1", [rideId])).status, "expired");
  assert.equal((await value("select available from public.drivers where profile_id = $1", [driver.id])).available, true);
  assert.equal(await acceptRide(rideId, driver.id), false);
});

test("9. tolerância e GPS isolado não geram taxa; trajeto verificado gera evidência", async () => {
  await database.query("update public.system_settings set value = jsonb_set(value, '{fee_active}', 'true'::jsonb) where key = 'cancellation_policy'");
  try {
    const passenger = await seedPassenger();
    const driver = await seedDriver();
    const rideId = await createRide(passenger);
    await createOffer(rideId, driver.id);
    assert.equal(await acceptRide(rideId, driver.id), true);
    await database.query("update public.rides set status = 'motorista_a_caminho' where id = $1", [rideId]);
    await database.query("insert into public.ride_approach_points(ride_id,driver_id,latitude,longitude,accuracy_meters) values ($1,$2,-10.8373,-38.5357,10)", [rideId, driver.id]);
    await database.query("update public.driver_locations set ride_id = $1, latitude = -10.8400, longitude = -38.5400, accuracy_meters = 10, updated_at = now() where driver_id = $2", [rideId, driver.id]);
    await database.query("select public.cancel_ride($1, $2, 'logo após aceite')", [rideId, passenger]);
    assert.equal((await value("select cancellation_fee_cents from public.rides where id = $1", [rideId])).cancellation_fee_cents, 0);

    const secondPassenger = await seedPassenger();
    const secondRide = await createRide(secondPassenger);
    await createOffer(secondRide, driver.id);
    assert.equal(await acceptRide(secondRide, driver.id), true);
    await database.query("update public.rides set status = 'motorista_a_caminho', accepted_at = now() - interval '3 minutes' where id = $1", [secondRide]);
    for (const [lng, seconds] of [[-38.5357, 25], [-38.5344, 15], [-38.5331, 5]]) {
      await database.query("insert into public.ride_approach_points(ride_id,driver_id,latitude,longitude,accuracy_meters,recorded_at) values ($1,$2,-10.8373,$3,10,now() - make_interval(secs => $4))", [secondRide, driver.id, lng, seconds]);
    }
    await database.query("select public.cancel_ride($1, $2, 'mudou de ideia')", [secondRide, secondPassenger]);
    const charged = await value("select cancellation_fee_cents,cancellation_fee_reason,cancellation_evidence,termination_code from public.rides where id = $1", [secondRide]);
    assert.equal(charged.cancellation_fee_cents, 500);
    assert.equal(charged.cancellation_fee_reason, "verified_driver_travel");
    assert.equal(charged.termination_code, "cancelled");
    assert.equal(charged.cancellation_evidence.approach_points, 3);
  } finally {
    await database.query("update public.system_settings set value = jsonb_set(value, '{fee_active}', 'false'::jsonb) where key = 'cancellation_policy'");
  }
});

test("10. no-show só é permitido após espera; viagem iniciada bloqueia cancelamento", async () => {
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, driver.id);
  assert.equal(await acceptRide(rideId, driver.id), true);
  await database.query("update public.rides set status = 'motorista_a_caminho' where id = $1", [rideId]);
  await database.query("update public.rides set status = 'motorista_chegou', arrived_at = now(), arrival_server_at = now(), arrival_verified = true where id = $1", [rideId]);
  assert.equal((await value("select public.cancel_ride($1, $2, 'NO_SHOW') as ride", [rideId, driver.id])).ride, null);
  await database.query("update public.rides set arrived_at = now() - interval '6 minutes', arrival_server_at = now() - interval '6 minutes' where id = $1", [rideId]);
  assert.equal((await value("select (public.cancel_ride($1, $2, 'NO_SHOW')).termination_code as code", [rideId, driver.id])).code, "no_show");
  assert.equal((await value("select available from public.drivers where profile_id = $1", [driver.id])).available, true);

  const nextRide = await createRide(await seedPassenger(), { driverId: driver.id, vehicleId: driver.vehicleId, status: "em_corrida" });
  assert.equal((await value("select public.cancel_ride($1, $2, 'desisti') as ride", [nextRide, passenger])).ride, null);
  assert.equal((await value("select status from public.rides where id = $1", [nextRide])).status, "em_corrida");
});

test("11. migração de cancelamento tolera reaplicação após execução manual", async () => {
  const migration = await readFile(path.join(process.cwd(), "supabase", "migrations",
    "20261001190000_driver_ride_cancellation_audit.sql"), "utf8");
  await database.exec(migration);
  assert.equal((await value("select count(*)::integer as count from pg_constraint where conrelid = 'public.rides'::regclass and conname = 'rides_cancellation_fee_nonnegative'")).count, 1);
});

test("12. motorista cancela sem GPS, libera sua corrida e redistribui a mesma solicitação", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const passenger = await seedPassenger();
  const first = await seedDriver();
  const second = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, first.id);
  assert.equal(await acceptRide(rideId, first.id), true);
  await database.query("update public.driver_locations set ride_id = $1 where driver_id = $2", [rideId, first.id]);
  await database.query("update public.rides set status = 'motorista_a_caminho' where id = $1", [rideId]);
  await database.query("delete from public.driver_locations where driver_id = $1", [first.id]);

  const result = await value("select (public.driver_cancel_and_redispatch($1,$2,'unsafe','Local inseguro')).status as status", [rideId, first.id]);
  assert.equal(result.status, "procurando_motorista");
  assert.deepEqual(await value("select status,driver_id from public.rides where id = $1", [rideId]), { status: "procurando_motorista", driver_id: null });
  assert.equal((await value("select available from public.drivers where profile_id = $1", [first.id])).available, true);
  assert.equal((await value("select ride_id from public.driver_locations where driver_id = $1", [first.id]))?.ride_id ?? null, null);
  assert.equal((await value("select driver_id from public.ride_requests where ride_id = $1 and status = 'pending'", [rideId])).driver_id, second.id);
  assert.equal((await value("select count(*)::integer as count from public.ride_driver_cancellations where ride_id = $1", [rideId])).count, 1);
  assert.equal(await acceptRide(rideId, second.id), true);
  assert.equal((await value("select next_driver_id from public.ride_driver_cancellations where ride_id = $1", [rideId])).next_driver_id, second.id);
  assert.equal((await value("select driver_id from public.rides where id = $1", [rideId])).driver_id, second.id);
  assert.equal((await value("select count(*)::integer as count from public.rides where passenger_id = $1", [passenger])).count, 1);
  assert.equal((await value("select count(*)::integer as count from public.notifications where user_id = $1 and type = 'ride.driver_cancelled'", [passenger])).count, 1);
  const retry = await value("select (public.driver_cancel_and_redispatch($1,$2,'unsafe','Local inseguro')).driver_id as driver_id", [rideId, first.id]);
  assert.equal(retry.driver_id, second.id);
  assert.equal((await value("select count(*)::integer as count from public.ride_driver_cancellations where ride_id = $1", [rideId])).count, 1);
});

test("13. sem outro motorista, redistribuição aguarda prazo e termina sem prender passageiro", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, driver.id);
  assert.equal(await acceptRide(rideId, driver.id), true);
  await database.query("update public.drivers set online = false where profile_id = $1", [driver.id]);
  await database.query("insert into public.passenger_locations(passenger_id,ride_id,latitude,longitude) values ($1,$2,-10.8373,-38.5357)", [passenger, rideId]);
  await database.query("select public.driver_cancel_and_redispatch($1,$2,'mechanical','Problema mecânico')", [rideId, driver.id]);
  assert.equal((await value("select status from public.rides where id = $1", [rideId])).status, "procurando_motorista");
  assert.equal((await value("select public.expire_ride_searches($1) as count", [rideId])).count, 0);
  await database.query("update public.rides set redispatch_started_at = now() - interval '6 minutes' where id = $1", [rideId]);
  assert.equal((await value("select public.expire_ride_searches($1) as count", [rideId])).count, 1);
  assert.equal((await value("select status from public.rides where id = $1", [rideId])).status, "cancelada");
  assert.equal((await value("select ride_id from public.passenger_locations where passenger_id = $1", [passenger])).ride_id, null);
});

test("14. viagem iniciada exige encerramento antecipado separado e registra o motivo", async () => {
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger, { driverId: driver.id, vehicleId: driver.vehicleId, status: "em_corrida", startedAt: new Date(Date.now() - 60_000).toISOString() });
  await database.query("update public.drivers set available = false where profile_id = $1", [driver.id]);
  await database.query("update public.driver_locations set ride_id = $1 where driver_id = $2", [rideId, driver.id]);
  await database.exec("update public.system_settings set value = value || '{\"configured\": true}'::jsonb where key = 'fare'");
  assert.equal((await value("select public.driver_cancel_and_redispatch($1,$2,'unsafe','Local inseguro') as ride", [rideId, driver.id])).ride, null);
  assert.equal((await value("select (public.end_ride_early($1,$2,'Passageiro pediu para parar')).status as status", [rideId, driver.id])).status, "finalizada");
  assert.equal((await value("select early_end_reason from public.rides where id = $1", [rideId])).early_end_reason, "Passageiro pediu para parar");
  assert.equal((await value("select (public.end_ride_early($1,$2,'Passageiro pediu para parar')).status as status", [rideId, driver.id])).status, "finalizada");
  assert.equal((await value("select count(*)::integer as count from public.audit_logs where entity_id = $1 and action = 'ride.ended_early'", [rideId])).count, 1);
  assert.equal((await value("select available from public.drivers where profile_id = $1", [driver.id])).available, true);
});

test("15. cancelamento do passageiro e do motorista preserva um único estado final", async () => {
  await database.query("update public.drivers set online = false, available = false");
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, driver.id);
  assert.equal(await acceptRide(rideId, driver.id), true);
  await database.query("select public.cancel_ride($1,$2,'Passageiro desistiu')", [rideId, passenger]);
  assert.equal((await value("select public.driver_cancel_and_redispatch($1,$2,'unsafe','Local inseguro') as ride", [rideId, driver.id])).ride, null);
  assert.equal((await value("select status from public.rides where id = $1", [rideId])).status, "cancelada");
  assert.equal((await value("select count(*)::integer as count from public.ride_driver_cancellations where ride_id = $1", [rideId])).count, 0);

  const nextPassenger = await seedPassenger();
  const nextDriver = await seedDriver();
  const nextRide = await createRide(nextPassenger);
  await createOffer(nextRide, nextDriver.id);
  assert.equal(await acceptRide(nextRide, nextDriver.id), true);
  await database.query("select public.driver_cancel_and_redispatch($1,$2,'unsafe','Local inseguro')", [nextRide, nextDriver.id]);
  await database.query("select public.cancel_ride($1,$2,'Passageiro desistiu')", [nextRide, nextPassenger]);
  assert.equal((await value("select status from public.rides where id = $1", [nextRide])).status, "cancelada");
  assert.equal((await value("select count(*)::integer as count from public.ride_driver_cancellations where ride_id = $1", [nextRide])).count, 1);
  assert.equal((await value("select count(*)::integer as count from public.rides where passenger_id = $1", [nextPassenger])).count, 1);
});

test("16. migração de redistribuição tolera nova execução no SQL Editor", async () => {
  const migration = await readFile(path.join(process.cwd(), "supabase", "migrations",
    "20261001235000_driver_cancel_redispatch.sql"), "utf8");
  await database.exec(migration);
  assert.equal((await value("select count(*)::integer as count from information_schema.columns where table_schema = 'public' and table_name = 'rides' and column_name = 'redispatch_started_at'")).count, 1);
  assert.equal((await value("select count(*)::integer as count from pg_trigger where tgname = 'link_redispatched_driver'")).count, 1);
});

test("17. ausência sem chegada GPS verificada é barrada também no banco", async () => {
  const passenger = await seedPassenger();
  const driver = await seedDriver();
  const rideId = await createRide(passenger);
  await createOffer(rideId, driver.id);
  assert.equal(await acceptRide(rideId, driver.id), true);
  await database.query("update public.rides set status = 'motorista_a_caminho' where id = $1", [rideId]);
  await database.query("update public.rides set status = 'motorista_chegou', arrival_server_at = now() - interval '6 minutes', arrival_verified = false where id = $1", [rideId]);
  await assert.rejects(database.query("select public.cancel_ride($1,$2,'NO_SHOW')", [rideId, driver.id]), /Ausencia exige chegada verificada/);
  assert.equal((await value("select status from public.rides where id = $1", [rideId])).status, "motorista_chegou");
});
