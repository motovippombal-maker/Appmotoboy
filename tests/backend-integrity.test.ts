import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertProfilePhoneAvailable, resolvePhoneIdentity } from "../lib/auth/phone-lookup";
import { brazilianPhoneSchema, profilePhoneError } from "../lib/auth/phone-validation";
import { phoneAuthEmail } from "../lib/auth/phone-identity";
import { rideAssignmentFilters, sameRideAssignment } from "../lib/backend/ride-assignment";

const PHONE_MIGRATION = "20261020130000_profile_phone_identity.sql";
let db: PGlite;
const legacyId = randomUUID();
const originalId = randomUUID();
const legacyPhone = "+5575999991001";
const originalPhone = "+5575999991002";
const changedPhone = "+5575999991003";

async function openDatabase(stopBeforePhone = false) {
  const database = await PGlite.create({ extensions: { pgcrypto } });
  await database.exec(`create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create publication supabase_realtime;`);
  for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === PHONE_MIGRATION) {
      if (stopBeforePhone) break;
      await database.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)", [
        legacyId, "cliente-legado@example.test", { phone: "(75) 99999-1001" },
        originalId, phoneAuthEmail(originalPhone), { phone: originalPhone },
      ]);
    }
    await database.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  return database;
}

async function row<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

async function asUser(userId: string, sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('test.user',$1,true)", [userId]);
    await db.exec("set local role authenticated");
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

function identityClient() {
  return {
    rpc: async (name: string, args: { p_phone: string }) => {
      assert.equal(name, "resolve_phone_login");
      const result = await row("select public.resolve_phone_login($1) as identity", [args.p_phone]);
      return { data: result.identity, error: null };
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
}

async function account(role = "passenger", phone?: string) {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, `${id}@example.test`, { role, ...(phone ? { phone } : {}) }]);
  return id;
}

async function driver() {
  const id = await account("driver");
  await db.query("insert into public.vehicles(driver_id,brand,model,color,plate) values($1,'Honda','CG','Preta',$2)", [id, id.slice(0, 7)]);
  await db.query("update public.drivers set approval_status='approved',online=true,available=true where profile_id=$1", [id]);
  return id;
}

async function ride(passengerId: string, old = false, coupon: "reserved" | "unreserved" | null = null) {
  const id = randomUUID();
  const couponId = coupon ? randomUUID() : null;
  const code = coupon ? `C${id.slice(0, 8).replaceAll("-", "").toUpperCase()}` : null;
  if (couponId) await db.query("insert into public.coupons(id,code,discount_type,discount_value,usage_limit) values($1,$2,'fixed',200,1)", [couponId, code]);
  await db.query(`insert into public.rides(id,passenger_id,status,origin_address,origin_lat,origin_lng,
    destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,fare_cents,
    fare_pricing_mode,coupon_id,coupon_code,discount_cents,original_fare_cents)
    values($1,$2,'procurando_motorista','Origem',-10.8373,-38.5357,'Destino',-10.8422,-38.5299,1500,600,$3,
      'region',$4,$5,$6,$7)`, [id, passengerId, coupon ? 500 : 700, couponId, code, coupon ? 200 : 0, coupon ? 700 : null]);
  if (old) await db.query("update public.rides set created_at=now()-interval '3 minutes',requested_at=now()-interval '3 minutes' where id=$1", [id]);
  if (coupon === "reserved") await db.query("insert into public.coupon_redemptions(coupon_id,user_id,ride_id,discount_cents) values($1,$2,$3,200)", [couponId, passengerId, id]);
  return { id, couponId, code };
}

async function expire(id: string) {
  return (await row("select public.expire_ride_searches($1) as changed", [id])).changed;
}

before(async () => { db = await openDatabase(); });
after(async () => { await db?.close(); });

test("telefone legado é preservado e login resolve o e-mail original sem escolher o primeiro perfil", async () => {
  assert.equal((await row("select phone from public.profiles where id=$1", [legacyId])).phone, "(75) 99999-1001");
  assert.deepEqual(await resolvePhoneIdentity(identityClient(), legacyPhone), {
    id: legacyId, phone: legacyPhone, email: "cliente-legado@example.test",
  });
  assert.equal((await resolvePhoneIdentity(identityClient(), "+5575999999999")), null);
});

test("escrita autenticada normaliza o próprio telefone e recusa duplicação com ou sem +55", async () => {
  await asUser(originalId, "update public.profiles set phone='(75) 99999-1002' where id=$1", [originalId]);
  assert.equal((await row("select phone from public.profiles where id=$1", [originalId])).phone, originalPhone);
  for (const phone of ["(75) 99999-1001", "5575999991001", "+55 75 99999-1001"]) {
    await assert.rejects(asUser(originalId, "update public.profiles set phone=$2 where id=$1", [originalId, phone]), (error: unknown) => (error as { code: string }).code === "23505");
  }
  assert.equal((await row("select phone from public.profiles where id=$1", [originalId])).phone, originalPhone);
});

test("alterar contato preserva login pelo novo telefone e pelo alias original, que outra conta não pode assumir", async () => {
  await assertProfilePhoneAvailable(identityClient(), originalId, changedPhone);
  await asUser(originalId, "update public.profiles set phone=$2 where id=$1", [originalId, changedPhone]);
  const oldLogin = await resolvePhoneIdentity(identityClient(), originalPhone);
  const newLogin = await resolvePhoneIdentity(identityClient(), changedPhone);
  assert.equal(oldLogin?.id, originalId);
  assert.equal(newLogin?.id, originalId);
  assert.equal(newLogin?.email, phoneAuthEmail(originalPhone));
  const other = await account();
  await assert.rejects(asUser(other, "update public.profiles set phone=$2 where id=$1", [other, originalPhone]), /Telefone reservado/);
  await assert.rejects(assertProfilePhoneAvailable(identityClient(), other, originalPhone), (error: unknown) => (error as { code: string }).code === "PHONE_ALREADY_REGISTERED");
});

test("resolver de identidade é restrito ao backend, e resposta ambígua/sem migração não escolhe conta arbitrária", async () => {
  for (const role of ["anon", "authenticated"]) assert.equal((await row("select has_function_privilege($1,'public.resolve_phone_login(text)','EXECUTE') as allowed", [role])).allowed, false);
  assert.equal((await row("select has_function_privilege('service_role','public.resolve_phone_login(text)','EXECUTE') as allowed")).allowed, true);
  await assert.rejects(asUser(legacyId, "select public.resolve_phone_login($1)", [legacyPhone]), /permission denied|permiss/i);
  const missing = { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) } as unknown as Pick<SupabaseClient, "rpc">;
  await assert.rejects(resolvePhoneIdentity(missing, legacyPhone), (error: unknown) => (error as { code: string }).code === "PHONE_IDENTITY_NOT_CONFIGURED");
  const ambiguous = { rpc: async () => ({ data: [{ id: legacyId }, { id: originalId }], error: null }) } as unknown as Pick<SupabaseClient, "rpc">;
  await assert.rejects(resolvePhoneIdentity(ambiguous, legacyPhone), (error: unknown) => (error as { code: string }).code === "PHONE_IDENTITY_UNAVAILABLE");
});

test("cadastro ou alteração direta do Auth não cria alias que mascare telefone de uma conta legada", async () => {
  const attemptedId = randomUUID();
  await assert.rejects(db.query("insert into auth.users(id,email) values($1,$2)", [attemptedId, phoneAuthEmail(legacyPhone)]), /Telefone já cadastrado/);
  assert.equal((await row("select count(*)::integer as n from auth.users where id=$1", [attemptedId])).n, 0);
  const other = await account();
  await assert.rejects(db.query("update auth.users set email=$2 where id=$1", [other, phoneAuthEmail(legacyPhone)]), /Telefone já cadastrado/);
  await assert.rejects(db.query("insert into auth.users(id,email) values($1,$2)", [randomUUID(), phoneAuthEmail(originalPhone)]), /Telefone reservado/);
  assert.equal((await resolvePhoneIdentity(identityClient(), legacyPhone))?.id, legacyId);
});

test("migração recusa duplicatas e conflito de alias sem apagar ou reescrever dados existentes", async () => {
  const isolated = await openDatabase(true);
  try {
    const a = randomUUID(), b = randomUUID();
    await isolated.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.test',$2),($3,'b@example.test',$4)", [a, { phone: "(75) 99999-3001" }, b, { phone: "+5575999993001" }]);
    const beforeDuplicate = (await isolated.query("select id,phone from public.profiles order by id")).rows;
    const migration = await readFile(`supabase/migrations/${PHONE_MIGRATION}`, "utf8");
    await assert.rejects(isolated.exec(migration), /Telefones duplicados.*manualmente/);
    assert.deepEqual((await isolated.query("select id,phone from public.profiles order by id")).rows, beforeDuplicate);
    await isolated.query("update public.profiles set phone='+5575999993002' where id=$1", [a]);
    await isolated.query("update auth.users set email='5575999993001@phone.motovip.invalid' where id=$1", [a]);
    const beforeAlias = (await isolated.query("select id,phone from public.profiles order by id")).rows;
    await assert.rejects(isolated.exec(migration), /conflita com o alias.*manualmente/);
    assert.deepEqual((await isolated.query("select id,phone from public.profiles order by id")).rows, beforeAlias);
  } finally { await isolated.close(); }
});

test("validação de telefone de perfil rejeita entrada inválida e traduz conflito de unicidade para 409", () => {
  assert.equal(brazilianPhoneSchema.parse("(75) 99999-1001"), legacyPhone);
  for (const phone of ["(00) 99999-1001", "(75) 09999-1001", "texto999991001", "123"]) assert.equal(brazilianPhoneSchema.safeParse(phone).success, false);
  const conflict = profilePhoneError({ code: "23505", message: 'duplicate key violates unique constraint "profiles_phone_normalized_unique"' });
  assert.equal((conflict as { status?: number })?.status, 409);
  assert.equal((conflict as { code?: string })?.code, "PHONE_ALREADY_REGISTERED");
});

async function guardedTransition(id: string, snapshot: { status: string; driver_id?: string | null; accepted_at?: string | null }) {
  const values: unknown[] = [id, snapshot.status];
  const guards = rideAssignmentFilters(snapshot).map((guard) => {
    if (guard.operator === "is") return `${guard.column} is null`;
    values.push(guard.value);
    return `${guard.column} = $${values.length}`;
  });
  return db.query(`update public.rides set status='motorista_a_caminho' where id=$1 and status=$2 and ${guards.join(" and ")} returning driver_id,status,accepted_at`, values);
}

test("CAS impede que transição atrasada de A altere corrida redistribuída a B, incluindo resposta duplicate", async () => {
  const a = await driver(), b = await driver(), passenger = await account();
  const { id } = await ride(passenger);
  await db.query("select public.dispatch_next_offer($1)", [id]);
  assert.equal((await row("select public.accept_ride($1,$2) as accepted", [id, a])).accepted, true);
  const stale = await row<{ status: string; driver_id: string; accepted_at: string }>("select status,driver_id,accepted_at from public.rides where id=$1", [id]);
  await db.query("select public.driver_cancel_and_redispatch($1,$2,'mechanical','Pneu furado')", [id, a]);
  assert.equal((await row("select public.accept_ride($1,$2) as accepted", [id, b])).accepted, true);
  // Reproduz a condição anterior em uma transação desfeita: apenas id+status
  // aceitam a atualização de A e atingem a atribuição nova de B.
  await db.exec("begin");
  assert.equal((await db.query<{ driver_id: string }>("update public.rides set status='motorista_a_caminho' where id=$1 and status=$2 returning driver_id", [id, stale.status])).rows[0].driver_id, b);
  await db.exec("rollback");
  assert.equal((await guardedTransition(id, stale)).rows.length, 0);
  const current = await row<{ status: string; driver_id: string; accepted_at: string }>("select status,driver_id,accepted_at from public.rides where id=$1", [id]);
  assert.equal(current.status, "aceita");
  assert.equal(sameRideAssignment(stale, current), false);
  assert.equal(sameRideAssignment(current, current), true);
  // Mesmo motorista com nova data de aceite também é outra atribuição.
  await db.query("update public.rides set accepted_at=accepted_at+interval '1 second' where id=$1", [id]);
  assert.equal((await guardedTransition(id, current)).rows.length, 0);
  const latest = await row<{ status: string; driver_id: string; accepted_at: string }>("select status,driver_id,accepted_at from public.rides where id=$1", [id]);
  assert.equal(sameRideAssignment(current, latest), false);
  assert.equal((await guardedTransition(id, latest)).rows.length, 1);
  await db.query("select public.cancel_ride($1,$2,'Encerrar teste')", [id, passenger]);
  await db.query("update public.drivers set online=false,available=false where profile_id in ($1,$2)", [a, b]);
});

test("recuperação ignora criação recente sem ofertas e redistribui órfã antiga preservando a reserva de cupom", async () => {
  const online = await driver();
  const recent = await ride(await account());
  assert.equal(await expire(recent.id), 0);
  assert.equal((await row("select count(*)::integer as n from public.ride_requests where ride_id=$1", [recent.id])).n, 0);
  const old = await ride(await account(), true, "reserved");
  assert.equal(await expire(old.id), 1);
  assert.equal((await row("select status from public.rides where id=$1", [old.id])).status, "procurando_motorista");
  assert.equal((await row("select driver_id from public.ride_requests where ride_id=$1", [old.id])).driver_id, online);
  assert.equal((await row("select count(*)::integer as n from public.coupon_redemptions where ride_id=$1", [old.id])).n, 1);
  await db.query("update public.drivers set online=false,available=false where profile_id=$1", [online]);
});

test("órfã sem motorista expira uma vez, libera passageiro e devolve a reserva de cupom nunca distribuído", async () => {
  for (const privilege of ["SELECT", "DELETE"])
    assert.equal((await row("select has_table_privilege('service_role','public.coupon_redemptions',$1) as allowed", [privilege])).allowed, true);
  assert.equal((await row("select has_table_privilege('authenticated','public.coupon_redemptions','DELETE') as allowed")).allowed, false);
  await db.query("update public.drivers set online=false,available=false");
  const passenger = await account();
  const old = await ride(passenger, true, "reserved");
  assert.equal(await expire(old.id), 1);
  assert.equal((await row("select status from public.rides where id=$1", [old.id])).status, "cancelada");
  assert.equal((await row("select count(*)::integer as n from public.coupon_redemptions where ride_id=$1", [old.id])).n, 0);
  assert.equal(await expire(old.id), 0);
  assert.equal((await row("select count(*)::integer as n from public.notifications where data->>'rideId'=$1 and type='ride.no_driver_found'", [old.id])).n, 1);
  const next = await ride(passenger);
  await db.query("update public.rides set coupon_id=$2,coupon_code=$3,fare_cents=500,original_fare_cents=700,discount_cents=200 where id=$1", [next.id, old.couponId, old.code]);
  await db.query("insert into public.coupon_redemptions(coupon_id,user_id,ride_id,discount_cents) values($1,$2,$3,200)", [old.couponId, passenger, next.id]);
  assert.equal((await row("select count(*)::integer as n from public.coupon_redemptions where ride_id=$1", [next.id])).n, 1);
});

test("órfã interrompida antes da reserva do cupom não recebe oferta com desconto não reservado", async () => {
  const online = await driver();
  const old = await ride(await account(), true, "unreserved");
  assert.equal(await expire(old.id), 1);
  assert.equal((await row("select status from public.rides where id=$1", [old.id])).status, "cancelada");
  assert.equal((await row("select count(*)::integer as n from public.ride_requests where ride_id=$1", [old.id])).n, 0);
  assert.equal((await row("select count(*)::integer as n from public.payments where ride_id=$1", [old.id])).n, 0);
  await db.query("update public.drivers set online=false,available=false where profile_id=$1", [online]);
});

test("recuperação mantém os cinco minutos de espera após redistribuição e a migração é reaplicável", async () => {
  const old = await ride(await account(), true);
  await db.query("update public.rides set redispatch_started_at=now() where id=$1", [old.id]);
  assert.equal(await expire(old.id), 0);
  await db.query("update public.rides set redispatch_started_at=now()-interval '6 minutes' where id=$1", [old.id]);
  assert.equal(await expire(old.id), 1);
  await db.exec(await readFile("supabase/migrations/20261020131000_recover_unoffered_rides.sql", "utf8"));
  await db.exec(await readFile(`supabase/migrations/${PHONE_MIGRATION}`, "utf8"));
});
