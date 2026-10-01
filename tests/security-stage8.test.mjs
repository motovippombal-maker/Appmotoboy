import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { assertProfileAccess, bearerToken } from "../lib/backend/authorization.ts";

let db;
const users = {};
const root = process.cwd();
const row = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const source = async (file) => readFile(path.join(root, file), "utf8");

async function account(role = "passenger") {
  const id = randomUUID();
  await db.query("insert into auth.users(id,raw_user_meta_data) values ($1,$2)", [id, role === "driver" ? { role } : {}]);
  if (role === "admin") await db.query("update public.profiles set role='admin' where id=$1", [id]);
  if (role === "driver") await db.query("insert into public.vehicles(driver_id,brand,model,color,plate) values ($1,'Honda','CG','Preta',$2)", [id, `A${id.slice(0, 6)}`]);
  return id;
}

async function asUser(id, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('app.test_user',$1,true)", [id]);
    await db.exec("set local role authenticated");
    const result = await db.query(sql, params);
    await db.exec("rollback");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function ride(passengerId, driverId = null, status = "finalizada") {
  const id = randomUUID();
  await db.query(`insert into public.rides(id,passenger_id,driver_id,status,origin_address,origin_lat,origin_lng,
    destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,fare_cents,payment_method)
    values ($1,$2,$3,$4,'Origem',-10.83,-38.53,'Destino',-10.84,-38.54,1200,400,700,'cash')`, [id, passengerId, driverId, status]);
  return id;
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.test_user',true),'')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create publication supabase_realtime;`);
  const directory = path.join(root, "supabase", "migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  users.passenger = await account();
  users.otherPassenger = await account();
  users.blockedPassenger = await account();
  users.driver = await account("driver");
  users.otherDriver = await account("driver");
  users.pendingDriver = await account("driver");
  users.admin = await account("admin");
  await db.query("update public.drivers set approval_status='approved',online=true,available=true where profile_id in ($1,$2)", [users.driver, users.otherDriver]);
  await db.query("update public.profiles set blocked=true where id=$1", [users.blockedPassenger]);
});
after(async () => db?.close());

test("1. passageiro não altera role para admin", async () => {
  await assert.rejects(asUser(users.passenger, "update public.profiles set role='admin' where id=$1", [users.passenger]), /permission denied|permiss/i);
});
test("2. motorista não altera role para admin", async () => {
  await assert.rejects(asUser(users.driver, "update public.profiles set role='admin' where id=$1", [users.driver]), /permission denied|permiss/i);
});
test("3. conta bloqueada não altera blocked", async () => {
  await assert.rejects(asUser(users.blockedPassenger, "update public.profiles set blocked=false where id=$1", [users.blockedPassenger]), /permission denied|permiss/i);
});
test("4. edição direta de campo administrativo é negada, nome próprio permitido", async () => {
  await assert.rejects(asUser(users.passenger, "update public.drivers set approval_status='approved' where profile_id=$1", [users.driver]), /permission denied|permiss/i);
  assert.equal((await asUser(users.passenger, "update public.profiles set full_name='Teste' where id=$1 returning full_name", [users.passenger]))[0].full_name, "Teste");
});
test("5. passageiro é 403 e todas as APIs admin usam gate central", async () => {
  assert.throws(() => assertProfileAccess({ role: "passenger", blocked: false }, ["admin"]), (error) => error.status === 403);
  for (const file of [
    "drivers/route.ts", "drivers/[id]/approval/route.ts", "fare/route.ts",
    "fare-regions/route.ts", "quick-places/route.ts", "quick-places/geocode/route.ts",
    "finance/route.ts", "overview/route.ts", "map/route.ts", "dispatch/route.ts",
  ]) {
    assert.match(await source(`app/api/admin/${file}`), /requireAdmin\(request\)/);
  }
});
test("6. motorista é 403 no gate administrativo", () => {
  assert.throws(() => assertProfileAccess({ role: "driver", blocked: false }, ["admin"]), (error) => error.status === 403);
});
test("7. admin ativo passa pelo gate administrativo", () => {
  assert.doesNotThrow(() => assertProfileAccess({ role: "admin", blocked: false }, ["admin"]));
});
test("8. API administrativa sem bearer retorna 401", async () => {
  assert.throws(() => bearerToken(new Request("https://local.test/api/admin/drivers")), (error) => error.status === 401);
});
test("9. passageiro não lê corrida de outro passageiro", async () => {
  const id = await ride(users.otherPassenger);
  assert.equal((await asUser(users.passenger, "select id from public.rides where id=$1", [id])).length, 0);
  assert.equal((await asUser(users.otherPassenger, "select id from public.rides where id=$1", [id])).length, 1);
});
test("10. motorista não lê pagamento vinculado a outro motorista", async () => {
  const id = await ride(users.otherPassenger, users.otherDriver);
  await db.query("insert into public.payments(ride_id,passenger_id,method,amount_cents) values ($1,$2,'cash',700)", [id, users.otherPassenger]);
  assert.equal((await asUser(users.driver, "select id from public.payments where ride_id=$1", [id])).length, 0);
  assert.equal((await asUser(users.otherDriver, "select id from public.payments where ride_id=$1", [id])).length, 1);
});
test("11. motorista não aprovado não pode ficar online", async () => {
  assert.equal((await row("select approval_status from public.drivers where profile_id=$1", [users.pendingDriver])).approval_status, "pending");
  await assert.rejects(asUser(users.pendingDriver, "update public.drivers set online=true where profile_id=$1", [users.pendingDriver]), /permission denied|permiss/i);
  assert.equal((await asUser(users.passenger, "select profile_id from public.drivers where profile_id=$1", [users.pendingDriver])).length, 0);
  assert.equal((await asUser(users.passenger, "select profile_id from public.drivers where profile_id=$1", [users.driver])).length, 1);
  assert.equal((await asUser(users.passenger, "select driver_id from public.driver_locations where driver_id=$1", [users.driver])).length, 0);
  assert.match(await source("app/api/drivers/status/route.ts"), /approval_status !== "approved"/);
});
test("12. motorista não aprovado não aceita oferta", async () => {
  const id = await ride(users.passenger, null, "procurando_motorista");
  await db.query("insert into public.ride_requests(ride_id,driver_id,expires_at) values ($1,$2,now()+interval '5 minutes')", [id, users.pendingDriver]);
  await db.query("insert into public.driver_locations(driver_id,latitude,longitude) values ($1,-10.83,-38.53)", [users.pendingDriver]);
  assert.equal((await row("select public.accept_ride($1,$2) as accepted", [id, users.pendingDriver])).accepted, false);
  await db.query("update public.rides set status='cancelada' where id=$1", [id]);
});
test("13. motorista não se autoaprova nem chama RPC administrativa", async () => {
  await assert.rejects(asUser(users.pendingDriver, "update public.drivers set approval_status='approved' where profile_id=$1", [users.pendingDriver]), /permission denied|permiss/i);
  await assert.rejects(asUser(users.pendingDriver, "select public.admin_set_driver_approval($1,$1,'approved')", [users.pendingDriver]), /permission denied|permiss/i);
});
test("14. admin aprova motorista e a ação fica auditada", async () => {
  const result = (await row("select public.admin_set_driver_approval($1,$2,'approved') as result", [users.pendingDriver, users.admin])).result;
  assert.equal(result.approval_status, "approved");
  assert.equal((await row("select count(*)::integer as n from public.audit_logs where actor_id=$1 and action='driver.approved' and entity_id=$2", [users.admin, users.pendingDriver])).n, 1);
});
test("15. mudança relevante de veículo revoga aprovação em ambos os caminhos", async () => {
  const before = await row("select id,plate from public.vehicles where driver_id=$1", [users.pendingDriver]);
  await db.query("update public.vehicles set color='Azul' where id=$1", [before.id]);
  assert.equal((await row("select approval_status from public.drivers where profile_id=$1", [users.pendingDriver])).approval_status, "pending");
  assert.match(await source("app/api/driver/profile/route.ts"), /saveDriverVehicle\(/);
  assert.match(await source("app/api/driver/vehicle/route.ts"), /saveDriverVehicle\(/);
  assert.match(await source("lib/backend/driver-vehicle.ts"), /\.strict\(\)/);
});
test("16. passageiro não edita tarifa", async () => {
  await assert.rejects(asUser(users.passenger, "update public.system_settings set value='{}'::jsonb where key='fare'"), /permission denied|permiss/i);
});
test("17. motorista não edita região", async () => {
  await assert.rejects(asUser(users.driver, "insert into public.fare_regions(name,amount_cents) values ('Invasão',100)"), /permission denied|permiss/i);
});
test("18. passageiro não edita ponto rápido", async () => {
  await assert.rejects(asUser(users.passenger, "delete from public.quick_places"), /permission denied|permiss/i);
});
test("19. alteração administrativa de tarifa e região usa gate e auditoria", async () => {
  for (const file of ["app/api/admin/fare/route.ts", "app/api/admin/fare-regions/route.ts", "app/api/admin/dispatch/route.ts"]) {
    const code = await source(file);
    assert.match(code, /requireAdmin\(request\)/);
    assert.match(code, /audit\(/);
  }
});
test("20. usuário não invoca função privilegiada de aceite", async () => {
  assert.equal((await row("select has_function_privilege('authenticated','public.accept_ride(uuid,uuid)','EXECUTE') as allowed")).allowed, false);
  assert.equal((await row("select has_function_privilege('authenticated','public.admin_set_driver_approval(uuid,uuid,text)','EXECUTE') as allowed")).allowed, false);
});
test("21. passageiro bloqueado não solicita corrida", async () => {
  assert.throws(() => assertProfileAccess({ role: "passenger", blocked: true }, ["passenger"]), (error) => error.status === 403);
  await assert.rejects(ride(users.blockedPassenger, null, "solicitada"), /bloqueado/i);
});
test("22. motorista bloqueado não fica online", async () => {
  await db.query("select public.admin_set_driver_approval($1,$2,'blocked')", [users.driver, users.admin]);
  assert.throws(() => assertProfileAccess({ role: "driver", blocked: true }, ["driver"]), (error) => error.status === 403);
  assert.deepEqual(await row("select approval_status,online,available from public.drivers where profile_id=$1", [users.driver]), { approval_status: "suspended", online: false, available: false });
});
test("23. motorista bloqueado não aceita nova corrida", async () => {
  const id = await ride(users.passenger, null, "procurando_motorista");
  await assert.rejects(db.query("update public.rides set driver_id=$1,status='aceita' where id=$2", [users.driver, id]), /bloqueado/i);
  await db.query("update public.rides set status='cancelada' where id=$1", [id]);
  const location = await source("app/api/location/route.ts");
  assert.match(location, /profile\.blocked && !input\.rideId/);
  assert.match(location, /INVALID_RIDE_LOCATION/);
});
test("24. role/admin falsificado no payload não concede permissão", async () => {
  assert.throws(() => assertProfileAccess({ role: "passenger", blocked: false }, ["admin"]), (error) => error.status === 403);
  const code = await source("lib/backend/api.ts");
  assert.match(code, /\.from\("profiles"\)/);
  assert.doesNotMatch(code, /request\.json\(\).*role/);
});
test("25. status financeiro falsificado permanece bloqueado", async () => {
  await assert.rejects(asUser(users.passenger, "update public.payments set status='pago'"), /permission denied|permiss/i);
  assert.match(await source("app/api/payments/cash/route.ts"), /cashConfirmationSchema/);
});
