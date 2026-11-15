import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

let db;
let customerId;
let ownerId;
let driverId;
let restaurantId;
let productId;
let groupId;
let optionId;

async function first(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function addUser(role = "passenger") {
  const id = randomUUID();
  await db.query("insert into auth.users(id,raw_user_meta_data) values ($1,$2)", [id, { role }]);
  return id;
}
async function order(items, idempotencyKey = randomUUID()) {
  return first(`select o.* from public.create_food_order($1,$2,$3,$4::jsonb,$5::jsonb,1200,'cash',null,$6,$7) o`, [
    customerId, restaurantId, idempotencyKey, JSON.stringify(items),
    JSON.stringify({ street: "Rua A", number: "10", district: "Centro", city: "Ribeira do Pombal", state: "BA", lat: -10.84, lng: -38.54 }),
    items.reduce((sum, item) => sum + item.quantity * 5490, 0), 600,
  ]);
}
async function transition(orderId, actorId, status, note = null) {
  return first("select o.* from public.transition_food_order($1,$2,$3,$4) o", [orderId, actorId, status, note]);
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create publication supabase_realtime;`);
  for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  customerId = await addUser(); ownerId = await addUser(); driverId = await addUser("driver");
  await db.query("insert into public.vehicles(driver_id,brand,model,color,plate) values ($1,'Honda','CG','Preta',$2)", [driverId, `T${driverId.slice(0, 6)}`]);
  await db.query("update public.drivers set approval_status='approved', online=true, on_shift=true, available=true where profile_id=$1", [driverId]);
  await db.query("insert into public.driver_delivery_preferences(driver_id,enabled) values ($1,true)", [driverId]);
  restaurantId = randomUUID(); productId = randomUUID(); groupId = randomUUID(); optionId = randomUUID();
  await db.query(`insert into public.restaurants(id,owner_id,name,responsible_name,phone,cuisine,address,latitude,longitude,status,accepting_orders)
    values ($1,$2,'Pizzaria Centro','Proprietário','75999999999','Pizza','Rua Central, 1',-10.8373,-38.5357,'approved',true)`, [restaurantId, ownerId]);
  await db.query("insert into public.menu_products(id,restaurant_id,name,price_cents) values ($1,$2,'Pizza',4990)", [productId, restaurantId]);
  await db.query("insert into public.menu_option_groups(id,product_id,name,min_choices,max_choices) values ($1,$2,'Tamanho',1,1)", [groupId, productId]);
  await db.query("insert into public.menu_options(id,group_id,name,price_cents) values ($1,$2,'Grande',500)", [optionId, groupId]);
  await db.exec("update public.delivery_settings set enabled=true, minimum_fee_cents=600, per_km_cents=200, max_distance_meters=10000");
});
after(async () => { await db?.close(); });

test("pedido grava preços reais, adicional, frete separado e idempotência", async () => {
  const key = randomUUID();
  const items = [{ productId, quantity: 2, optionIds: [optionId], notes: "Sem cebola", priceCents: 1 }];
  const created = await order(items, key);
  assert.equal(created.subtotal_cents, 10980);
  assert.equal(created.delivery_fee_cents, 600);
  assert.equal(created.total_cents, 11580);
  assert.equal((await order(items, key)).id, created.id);
  assert.equal((await first("select count(*)::int as total from public.food_order_items where order_id=$1", [created.id])).total, 1);
  assert.equal((await first("select count(*)::int as total from public.notifications where user_id=$1 and type='food.customer.received' and data->>'foodOrderId'=$2", [customerId, created.id])).total, 1);
  assert.equal((await first("select count(*)::int as total from public.notifications where user_id=$1 and type='food.restaurant.new' and data->>'foodOrderId'=$2", [ownerId, created.id])).total, 1);
});

test("adicional obrigatório inválido e restaurante suspenso bloqueiam checkout", async () => {
  await assert.rejects(order([{ productId, quantity: 1, optionIds: [] }]));
  await assert.rejects(first(`select o.* from public.create_food_order($1,$2,$3,$4::jsonb,$5::jsonb,1200,'cash',null,5490,600) o`, [
    customerId, restaurantId, randomUUID(), JSON.stringify([{ productId, quantity: 1, optionIds: [optionId] }]),
    JSON.stringify({ street: "Rua A", number: "10", district: "Centro", city: "Ribeira do Pombal", state: "BA", lng: -38.54 }),
  ]));
  await assert.rejects(first(`select o.* from public.create_food_order($1,$2,$3,$4::jsonb,$5::jsonb,1200,'cash',null,1,600) o`, [
    customerId, restaurantId, randomUUID(), JSON.stringify([{ productId, quantity: 1, optionIds: [optionId] }]),
    JSON.stringify({ street: "Rua A", number: "10", district: "Centro", city: "Ribeira do Pombal", state: "BA", lat: -10.84, lng: -38.54 }),
  ]));
  await db.query("update public.restaurants set status='suspended' where id=$1", [restaurantId]);
  await assert.rejects(order([{ productId, quantity: 1, optionIds: [optionId] }]));
  await db.query("update public.restaurants set status='approved' where id=$1", [restaurantId]);
});

test("restaurante prepara, motoboy aceita e motorista não pode assumir corrida simultânea", async () => {
  const created = await order([{ productId, quantity: 1, optionIds: [optionId] }]);
  assert.equal((await first("select private.restaurant_access($1,$2) as allowed", [restaurantId, ownerId])).allowed, true);
  assert.equal((await first("select status from public.food_orders where id=$1", [created.id])).status, "received");
  await assert.rejects(transition(created.id, driverId, "accepted"));
  await transition(created.id, ownerId, "accepted");
  await transition(created.id, ownerId, "preparing");
  await transition(created.id, ownerId, "ready");
  assert.equal((await first("select count(*)::int as total from public.notifications where user_id=$1 and type='food.driver.offer' and data->>'foodOrderId'=$2", [driverId, created.id])).total, 1);
  assert.equal((await first("select public.accept_food_delivery($1,$2) as accepted", [created.id, driverId])).accepted, true);
  assert.equal((await first("select public.accept_food_delivery($1,$2) as accepted", [created.id, driverId])).accepted, false);
  assert.equal((await first("select count(*)::int as total from public.notifications where user_id=$1 and type='food.driver.status' and data->>'foodOrderId'=$2", [driverId, created.id])).total, 1);
  assert.equal((await first("select available from public.drivers where profile_id=$1", [driverId])).available, false);
  await assert.rejects(db.query(`insert into public.rides(passenger_id,driver_id,status,origin_address,origin_lat,origin_lng,destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,fare_cents)
    values ($1,$2,'aceita','A',-10.83,-38.53,'B',-10.84,-38.54,1200,300,500)`, [customerId, driverId]));
  await transition(created.id, driverId, "at_restaurant");
  await assert.rejects(transition(created.id, driverId, "picked_up"));
  assert.equal((await first("select public.confirm_food_pickup($1,$2) as confirmed", [created.id, ownerId])).confirmed, true);
  await transition(created.id, driverId, "picked_up");
  await transition(created.id, driverId, "on_the_way");
  await transition(created.id, driverId, "delivered");
  assert.equal((await first("select available from public.drivers where profile_id=$1", [driverId])).available, true);
  assert.equal((await first("select status from public.food_orders where id=$1", [created.id])).status, "delivered");
  assert.ok((await first("select public.food_order_metrics($1) as metrics", [restaurantId])).metrics.unpaidCents > 0);
  assert.equal((await first("select payment_status from public.confirm_food_payment($1,$2)", [created.id, driverId])).payment_status, "paid");
  assert.equal((await first("select payment_status from public.confirm_food_payment($1,$2)", [created.id, driverId])).payment_status, "paid");
  assert.equal((await first("select count(*)::int as total from public.food_payment_events where order_id=$1", [created.id])).total, 1);
  assert.equal((await first("select public.food_order_metrics($1) as metrics", [restaurantId])).metrics.unpaidCents, 0);
});

test("motoboy devolve entrega antes da retirada e ela volta à fila", async () => {
  const created = await order([{ productId, quantity: 1, optionIds: [optionId] }]);
  await transition(created.id, ownerId, "accepted");
  await transition(created.id, ownerId, "preparing");
  await transition(created.id, ownerId, "ready");
  assert.equal((await first("select public.accept_food_delivery($1,$2) as accepted", [created.id, driverId])).accepted, true);
  const released = await first("select o.* from public.release_food_delivery($1,$2,$3) o", [created.id, driverId, "Moto indisponível"]);
  assert.equal(released.status, "ready");
  assert.equal(released.driver_id, null);
  assert.equal((await first("select available from public.drivers where profile_id=$1", [driverId])).available, true);
  assert.equal((await first("select public.accept_food_delivery($1,$2) as accepted", [created.id, driverId])).accepted, true);
});
