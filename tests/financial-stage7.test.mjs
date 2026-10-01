import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { buildQuoteClaims, quoteMatches } from "../lib/backend/quote-token.ts";
import { assertPaymentMethodAvailable, cashConfirmationSchema, getPixProvider } from "../lib/backend/payment.ts";

let db;
let cashRide;
let driver;
let passenger;
let otherDriver;
let admin;
let partialCoupon;
let freeRide;

async function one(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

async function account(role = "passenger") {
  const id = randomUUID();
  await db.query("insert into auth.users(id, raw_user_meta_data) values ($1, $2)", [id, role === "driver" ? { role } : {}]);
  if (role === "admin") await db.query("update public.profiles set role = 'admin' where id = $1", [id]);
  if (role === "driver") await db.query("update public.drivers set approval_status = 'approved', online = true where profile_id = $1", [id]);
  return id;
}

async function rideFor(passengerId, driverId, options = {}) {
  const id = randomUUID();
  const fare = options.fare ?? 700;
  const original = options.original ?? fare;
  const active = options.active ?? !options.couponId;
  await db.query(`insert into public.rides(
    id,passenger_id,driver_id,status,origin_address,origin_lat,origin_lng,
    destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,
    fare_cents,estimated_fare_cents,estimated_distance_meters,estimated_duration_seconds,
    fare_pricing_mode,started_at,payment_method,coupon_id,coupon_code,original_fare_cents,discount_cents
  ) values ($1,$2,$3,$4,'Origem',-10.8373,-38.5357,
    'Destino',-10.8422,-38.5299,1500,600,$5,$5,1500,600,
    'region',$11,$6,$7,$8,$9,$10)`, [
    id, passengerId, active ? driverId : null, options.status ?? (active ? "em_corrida" : "procurando_motorista"), fare,
    options.method ?? "cash", options.couponId ?? null, options.couponCode ?? null,
    options.couponId ? original : null, options.discount ?? 0, active ? new Date().toISOString() : null,
  ]);
  return id;
}

async function coupon(options = {}) {
  const id = randomUUID();
  const code = `C${id.slice(0, 8).toUpperCase()}`;
  await db.query(`insert into public.coupons(id,code,discount_type,discount_value,usage_limit,ends_at,active)
    values ($1,$2,$3,$4,$5,$6,$7)`, [id, code, options.type ?? "fixed", options.value ?? 200,
    options.limit ?? null, options.endsAt ?? null, options.active ?? true]);
  return { id, code };
}

async function redeem(c, userId, rideId, discount = 200) {
  return db.query("insert into public.coupon_redemptions(coupon_id,user_id,ride_id,discount_cents) values ($1,$2,$3,$4)", [c.id, userId, rideId, discount]);
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create publication supabase_realtime;`);
  const directory = path.join(process.cwd(), "supabase", "migrations");
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  await db.exec("update public.system_settings set value = value || '{\"configured\": true}'::jsonb where key = 'fare'");
  passenger = await account();
  driver = await account("driver");
  otherDriver = await account("driver");
  admin = await account("admin");
  cashRide = await rideFor(passenger, driver);
});

after(async () => db?.close());

test("1. finalizar dinheiro mantém pagamento pendente", async () => {
  assert.equal((await one("select (public.finish_ride($1,$2)).status as status", [cashRide, driver])).status, "finalizada");
  assert.deepEqual(await one("select status,amount_cents from public.payments where ride_id=$1", [cashRide]), { status: "aguardando_pagamento", amount_cents: 700 });
});

test("2. motorista vinculado confirma dinheiro", async () => {
  const result = (await one("select public.confirm_cash_payment($1,$2) as result", [cashRide, driver])).result;
  assert.equal(result.duplicate, false);
  assert.equal((await one("select status,paid_at is not null as paid from public.payments where ride_id=$1", [cashRide])).paid, true);
  assert.equal((await one("select payment_status from public.rides where id=$1", [cashRide])).payment_status, "pago");
});

test("3. confirmar duas vezes não duplica pagamento ou auditoria", async () => {
  assert.equal((await one("select public.confirm_cash_payment($1,$2) as result", [cashRide, driver])).result.duplicate, true);
  assert.equal((await one("select count(*)::integer as n from public.payments where ride_id=$1", [cashRide])).n, 1);
  assert.equal((await one("select count(*)::integer as n from public.audit_logs where action='payment.cash.confirmed' and metadata->>'ride_id'=$1", [cashRide])).n, 1);
  assert.equal((await one("select count(*)::integer as n from public.notifications where type='payment.paid' and data->>'rideId'=$1", [cashRide])).n, 1);
});

test("4. outro motorista não pode confirmar", async () => {
  await assert.rejects(one("select public.confirm_cash_payment($1,$2)", [cashRide, otherDriver]), /sem permissao/);
});

test("5. passageiro não pode confirmar", async () => {
  await assert.rejects(one("select public.confirm_cash_payment($1,$2)", [cashRide, passenger]), /sem permissao/);
});

test("6. administrador confirma e fica auditado", async () => {
  const id = await rideFor(await account(), driver);
  await one("select public.finish_ride($1,$2)", [id, driver]);
  assert.equal((await one("select public.confirm_cash_payment($1,$2) as result", [id, admin])).result.duplicate, false);
  assert.equal((await one("select actor_id from public.audit_logs where action='payment.cash.confirmed' and metadata->>'ride_id'=$1", [id])).actor_id, admin);
});

test("7. cupom parcial registra desconto correto", async () => {
  partialCoupon = await coupon();
  const user = await account();
  const id = await rideFor(user, driver, { fare: 500, original: 700, discount: 200, couponId: partialCoupon.id, couponCode: partialCoupon.code });
  await redeem(partialCoupon, user, id);
  assert.deepEqual(await one("select original_fare_cents,discount_cents,fare_cents from public.rides where id=$1", [id]), { original_fare_cents: 700, discount_cents: 200, fare_cents: 500 });
});

test("8. cupom expirado é rejeitado no banco", async () => {
  const c = await coupon({ endsAt: "2020-01-01T00:00:00Z" });
  const user = await account();
  const id = await rideFor(user, driver, { fare: 500, original: 700, discount: 200, couponId: c.id, couponCode: c.code });
  await assert.rejects(redeem(c, user, id), /indisponivel/);
});

test("9. limite global de cupom é respeitado", async () => {
  const c = await coupon({ limit: 1 });
  const a = await account(); const b = await account();
  const first = await rideFor(a, driver, { fare: 500, original: 700, discount: 200, couponId: c.id, couponCode: c.code });
  const second = await rideFor(b, driver, { fare: 500, original: 700, discount: 200, couponId: c.id, couponCode: c.code });
  await redeem(c, a, first);
  await assert.rejects(redeem(c, b, second), /Limite/);
});

test("10. último uso concorrente aceita somente um resgate", async () => {
  const c = await coupon({ limit: 1 });
  const a = await account(); const b = await account();
  const first = await rideFor(a, driver, { fare: 500, original: 700, discount: 200, couponId: c.id, couponCode: c.code });
  const second = await rideFor(b, driver, { fare: 500, original: 700, discount: 200, couponId: c.id, couponCode: c.code });
  const outcomes = await Promise.allSettled([redeem(c, a, first), redeem(c, b, second)]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await one("select count(*)::integer as n from public.coupon_redemptions where coupon_id=$1", [c.id])).n, 1);
});

test("11. cupom de 100% permite valor final zero", async () => {
  const c = await coupon({ type: "percentage", value: 100 });
  const user = await account();
  freeRide = await rideFor(user, driver, { fare: 0, original: 700, discount: 700, couponId: c.id, couponCode: c.code, active: true });
  await redeem(c, user, freeRide, 700);
  assert.equal((await one("select fare_cents from public.rides where id=$1", [freeRide])).fare_cents, 0);
});

test("12. corrida gratuita não cria cobrança em dinheiro ou Pix", async () => {
  await one("select public.finish_ride($1,$2)", [freeRide, driver]);
  assert.equal((await one("select payment_status,final_fare_cents from public.rides where id=$1", [freeRide])).final_fare_cents, 0);
  assert.equal((await one("select payment_status from public.rides where id=$1", [freeRide])).payment_status, "pago");
  assert.equal((await one("select count(*)::integer as n from public.payments where ride_id=$1", [freeRide])).n, 0);
  assert.equal((await one("select count(*)::integer as n from public.audit_logs where action='payment.waived' and entity_id=$1", [freeRide])).n, 1);
});

test("13. desconto adulterado é rejeitado", async () => {
  const user = await account();
  const id = await rideFor(user, driver, { fare: 499, original: 700, discount: 201, couponId: partialCoupon.id, couponCode: partialCoupon.code });
  await assert.rejects(redeem(partialCoupon, user, id, 201), /Desconto/);
});

test("14. revisão do cupom invalida cotação anterior", () => {
  const base = { passengerId: passenger, origin: { lat: -10, lng: -38 }, destination: { lat: -11, lng: -39 },
    resolvedFare: { snapshot: { regionId: "r", amountCents: 700, regionPriority: 0, regionUpdatedAt: "a", originServiceAreaId: "s", originServiceAreaUpdatedAt: "a", serviceAreaId: "s", serviceAreaUpdatedAt: "a", resolution: "default" } },
    fareCents: 500, originalFareCents: 700, discountCents: 200, couponCode: "TESTE", now: 1000 };
  const previous = buildQuoteClaims({ ...base, couponRevision: "rev-1" });
  const current = buildQuoteClaims({ ...base, couponRevision: "rev-2" });
  assert.equal(quoteMatches(previous, current), false);
});

test("15. formulário mobile usa controles financeiros compartilhados", async () => {
  const source = await readFile(path.join(process.cwd(), "app", "page.tsx"), "utf8");
  assert.match(source, /<FinancialControls\s+estimate=\{estimate\}/);
  assert.match(source, /paymentMethod=\{paymentMethod\} setPaymentMethod=\{setPaymentMethod\}/);
});

test("16. formulário desktop usa o mesmo componente e estado", async () => {
  const source = await readFile(path.join(process.cwd(), "app", "page.tsx"), "utf8");
  assert.equal((source.match(/<FinancialControls\s/g) || []).length, 2);
  assert.match(source, /useState<"pix" \| "cash">\("cash"\)/);
});

test("17. Pix sem adaptador homologado permanece indisponível", () => {
  assert.throws(() => getPixProvider(), /Provedor Pix|adaptador homologado/);
});

test("18. backend bloqueia requisição direta com Pix", async () => {
  assert.throws(() => assertPaymentMethodAvailable("pix"), /Provedor Pix|adaptador homologado/);
  assert.doesNotThrow(() => assertPaymentMethodAvailable("cash"));
});

test("19. status pago arbitrário não é aceito na confirmação", async () => {
  assert.equal(cashConfirmationSchema.safeParse({ rideId: cashRide, status: "pago" }).success, false);
  await assert.rejects(one("update public.payments set amount_cents=1 where ride_id=$1", [cashRide]), /imutavel/);
  await db.exec("begin; set local role authenticated");
  try {
    await assert.rejects(one("update public.payments set status='pago' where ride_id=$1", [cashRide]), /permission denied/);
  } finally {
    await db.exec("rollback");
  }
});

test("20. recebido e pendente não se sobrepõem no financeiro", async () => {
  const pendingRide = await rideFor(await account(), driver);
  await one("select public.finish_ride($1,$2)", [pendingRide, driver]);
  const totals = await one(`select
    coalesce(sum(amount_cents) filter(where status='pago'),0)::integer as received,
    coalesce(sum(amount_cents) filter(where status='aguardando_pagamento'),0)::integer as pending
    from public.payments where ride_id in ($1,$2)`, [cashRide, pendingRide]);
  assert.deepEqual(totals, { received: 700, pending: 700 });
});
