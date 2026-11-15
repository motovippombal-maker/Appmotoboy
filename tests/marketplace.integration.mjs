// This suite applies all migrations to an in-memory PGlite database.
// It never connects to a PostgreSQL URL.
// A single connection verifies persistence/invariants, not concurrent clients.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

let db, areaId, fare, legacyRideId, legacyCash, cashPreparation;
const migrations = new URL("../supabase/migrations/", import.meta.url);
const origin = { address: "Rua da Loja, 12", lat: -10.8373, lng: -38.5357 };
const delivery = {
  address: "Rua de Entrega, 30", lat: -10.845, lng: -38.53,
  recipientName: "Pessoa de Teste", recipientPhone: "+5575999991234", notes: "Portão azul",
};
const query = (sql, params = []) => db.query(sql, params);
const row = async (sql, params) => (await query(sql, params)).rows[0];

async function asRole(role, sql, params, userId) {
  const setRole = {
    authenticated: "set local role authenticated",
    service_role: "set local role service_role",
    anon: "set local role anon",
  }[role];
  assert.ok(setRole);
  await db.exec("begin");
  try {
    if (userId) await query("select set_config('marketplace.test_user',$1,true)", [userId]);
    await db.exec(setRole);
    const result = await query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

function asUser(userId, sql, params = []) {
  return asRole("authenticated", sql, params, userId);
}

async function rpc(name, args) {
  assert.match(name, /^[a-z_]+$/);
  const placeholders = args.map((_, index) => "$" + (index + 1)).join(",");
  const result = await asRole("service_role", `select to_jsonb(public.${name}(${placeholders})) as value`, args);
  return result[0].value;
}

async function account(role = "passenger") {
  const id = randomUUID();
  await query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3::jsonb)", [
    id, id + "@example.test", role === "driver" ? { role } : {},
  ]);
  if (role === "admin") await query("update public.profiles set role='admin' where id=$1", [id]);
  return id;
}

async function regularRide(customerId) {
  return (await row(`
    insert into public.rides(passenger_id,status,origin_address,origin_lat,origin_lng,
      destination_address,destination_lat,destination_lng,distance_meters,duration_seconds,fare_cents,payment_method)
    values ($1,'procurando_motorista',$2,$3,$4,$5,$6,$7,1500,600,700,'cash') returning id
  `, [customerId, origin.address, origin.lat, origin.lng, delivery.address, delivery.lat, delivery.lng])).id;
}

async function store(stock = 5) {
  const owner = await account(), id = randomUUID();
  await query(`insert into public.market_stores(id,slug,name,category,address,latitude,longitude,
    service_area_id,status,is_open,prep_minutes)
    values($1,$2,'Loja de teste','Comida',$3,$4,$5,$6,'approved',true,20)
  `, [id, "loja-" + id.slice(0, 8), origin.address, origin.lat, origin.lng, areaId]);
  await query("insert into public.market_store_members(store_id,user_id,role) values($1,$2,'owner')", [id, owner]);
  const category = (await row("insert into public.market_categories(store_id,name) values($1,'Lanches') returning id", [id])).id;
  const product = (await row(`insert into public.market_products(store_id,category_id,name,price_cents,stock_quantity)
    values ($1,$2,'Sanduíche',1000,$3) returning id`, [id, category, stock])).id;
  const group = (await row(`insert into public.market_option_groups(store_id,product_id,name,min_select,max_select)
    values ($1,$2,'Complemento',1,1) returning id`, [id, product])).id;
  const option = (await row("insert into public.market_options(store_id,group_id,name,price_cents) values($1,$2,'Queijo',125) returning id", [id, group])).id;
  const otherOption = (await row("insert into public.market_options(store_id,group_id,name,price_cents) values($1,$2,'Ovo',200) returning id", [id, group])).id;
  return { id, owner, category, product, group, option, otherOption };
}

function cartOf(shop, quantity = 1, optionIds = [shop.option]) {
  return [{ productId: shop.product, quantity, optionIds }];
}

async function checkoutInputs(shop, customer, cart = cartOf(shop)) {
  const quote = await rpc("market_quote_catalog", [shop.id, cart]);
  return {
    quote, args: [customer, shop.id, randomUUID(), createHash("sha256").update(JSON.stringify({ cart, delivery })).digest("hex"),
      cart, quote.cartFingerprint, origin, delivery, fare],
  };
}

async function checkout(shop, customer = null) {
  const buyer = customer ?? await account();
  const { args } = await checkoutInputs(shop, buyer);
  const result = await rpc("market_checkout", args);
  assert.equal(result.reused, false);
  return { id: result.orderId, buyer };
}

async function order(id) {
  return row(`select status,logistics_status,total_cents,assigned_driver_id,dispatch_attempts,dispatch_exhausted_at
    from public.market_orders where id=$1`, [id]);
}
async function stock(productId) {
  return (await row("select stock_quantity from public.market_products where id=$1", [productId])).stock_quantity;
}

async function ready(shop, id) {
  assert.equal((await rpc("market_transition_order", [shop.owner,id,"accept",null])).status, "preparing");
  const result = await rpc("market_transition_order", [shop.owner,id,"ready",null]);
  assert.equal(result.status, "ready");
  assert.equal(result.logisticsStatus, "awaiting_driver");
}

async function driver({ gps = true, stale = false, online = true, lat = origin.lat, lng = origin.lng } = {}) {
  const id = await account("driver");
  await query("insert into public.vehicles(driver_id,brand,model,color,plate) values($1,'Honda','CG','Preta',$2)", [id, "T" + id.slice(0, 6)]);
  await query("update public.drivers set approval_status='approved', online=$2, available=$2, on_shift=$2 where profile_id=$1", [id, online]);
  if (gps) await query(`insert into public.driver_locations(driver_id,latitude,longitude,accuracy_meters,updated_at)
    values($1,$2,$3,8,now()-case when $4::boolean then interval '10 minutes' else interval '0 seconds' end)`, [id,lat,lng,stale]);
  return id;
}

const pauseDrivers = () => query("update public.drivers set online=false,available=false,on_shift=false");
const deliveryRide = (orderId) => row("select id,status,driver_id from public.rides where market_order_id=$1 order by created_at desc", [orderId]);
const pendingOffer = (rideId) => row("select driver_id,market_dispatch_source from public.ride_requests where ride_id=$1 and status='pending'", [rideId]);
const cashAction = (actor, id, action, amount, reference = null, note = null) =>
  rpc("market_record_cash_action", [actor,id,action,amount,reference,note]);

async function captureError(operation) {
  try { await operation(); return null; } catch (error) { return { code:error.code, message:error.message }; }
}

async function completeOrder(shop, id, courier) {
  await query("update public.market_stores set preferred_driver_id=$2 where id=$1", [shop.id,courier]);
  await ready(shop,id);
  assert.equal(await rpc("dispatch_market_order",[id]),true);
  const linked = await deliveryRide(id);
  assert.equal(await rpc("accept_market_delivery",[linked.id,courier]),true);
  await query("update public.rides set status='motorista_a_caminho' where id=$1",[linked.id]);
  await query("update public.rides set status='motorista_chegou',arrival_verified=true,arrived_at=now(),arrival_server_at=now() where id=$1",[linked.id]);
  assert.equal((await rpc("market_driver_delivery_action",[linked.id,courier,"pickup",null,null])).status,"em_corrida");
  assert.equal((await rpc("market_driver_delivery_action",[linked.id,courier,"complete",null,null])).status,"finalizada");
}

async function seedPricing() {
  const boundary = { type: "Polygon", coordinates: [[[-38.6,-10.9],[-38.4,-10.9],[-38.4,-10.7],[-38.6,-10.7],[-38.6,-10.9]]] };
  const area = await row("insert into public.service_areas(name,boundary) values('Área sintética de teste',$1::jsonb) returning id,name,updated_at::text as revision", [boundary]);
  const region = await row("select id,name,amount_cents,updated_at::text as revision from public.fare_regions where active and is_default");
  areaId = area.id;
  fare = {
    freightCents: region.amount_cents, discountCents: 0, distanceMeters: 1500, durationSeconds: 600,
    ruleSnapshot: {
      regionId: region.id, regionName: region.name, regionUpdatedAt: region.revision, amountCents: region.amount_cents,
      originServiceAreaId: area.id, originServiceAreaName: area.name, originServiceAreaUpdatedAt: area.revision,
      serviceAreaId: area.id, serviceAreaName: area.name, serviceAreaUpdatedAt: area.revision,
    },
  };
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('marketplace.test_user',true),'')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema auth to anon,authenticated,service_role;
    create publication supabase_realtime;
  `);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === "20261115120000_marketplace.sql") legacyRideId = await regularRide(await account());
    if (file === "20261115145000_marketplace_cash_integrity.sql") {
      await seedPricing();
      const shop = await store(), courier = await driver();
      const { id } = await checkout(shop);
      await completeOrder(shop,id,courier);
      const prior = await rpc("market_cash_action",[courier,id,"receive","Declaração anterior, sem campo de valor"]);
      legacyCash = { id,courier,owner:shop.owner,receivedAt:prior.receivedAt };
      await pauseDrivers();
    }
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
    if (file === "20261115145000_marketplace_cash_integrity.sql") {
      const shop = await store(), courier = await driver();
      const { id } = await checkout(shop);
      await completeOrder(shop,id,courier);
      const cash = await row("select amount_cents from public.market_cash_payments where order_id=$1",[id]);
      cashPreparation = {
        order:await order(id),
        oldError:await captureError(() => rpc("market_cash_action",[courier,id,"receive","Sem valor declarado"])),
        newError:await captureError(() => cashAction(courier,id,"receive",cash.amount_cents)),
        ledger:await row("select received_at,received_amount_cents,settled_at,settled_amount_cents from public.market_cash_payments where order_id=$1",[id]),
      };
      await pauseDrivers();
    }
  }
  assert.ok(legacyRideId);
  assert.ok(legacyCash);
  if ((await row("select to_regclass('private.marketplace_operation_environment') is not null as gated")).gated) {
    const shop = await store();
    const { args } = await checkoutInputs(shop, await account());
    await assert.rejects(rpc("market_checkout",args), /MARKETPLACE_OPERATIONS_PAUSED/);
    assert.equal(await stock(shop.product),5);
    await query(`insert into private.marketplace_operation_environment(singleton,operation_mode,environment_id,enabled)
      values(true,'isolated_test','794382dd-bec6-4420-9745-56c27410e718',true)`);
  }
});
after(async () => { await db?.close(); });

test("migrações preservam a corrida anterior e sua categoria de passageiro", async () => {
  assert.deepEqual(await row("select status,service_type,market_order_id from public.rides where id=$1", [legacyRideId]), {
    status: "procurando_motorista", service_type: "passenger", market_order_id: null,
  });
});

test("RLS isola pedidos, catálogo privado e membros; RPCs recusam usuário não privilegiado e IDs de outra loja", async () => {
  const a = await store(), b = await store();
  const orderA = await checkout(a), orderB = await checkout(b);
  const orderIds = [orderA.id,orderB.id], storeIds = [a.id,b.id];
  assert.deepEqual(await asUser(a.owner,"select id from public.market_orders where id=any($1::uuid[])",[orderIds]), [{ id: orderA.id }]);
  assert.deepEqual(await asUser(orderB.buyer,"select id from public.market_orders where id=any($1::uuid[])",[orderIds]), [{ id: orderB.id }]);
  assert.deepEqual(await asUser(a.owner,"select id from public.market_stores where id=any($1::uuid[])",[storeIds]), [{ id: a.id }]);
  assert.deepEqual(await asUser(a.owner,"select store_id from public.market_store_members where store_id=any($1::uuid[])",[storeIds]), [{ store_id: a.id }]);
  assert.deepEqual(await asUser(orderA.buyer,"select order_id from public.market_cash_payments where order_id=$1",[orderA.id]), []);
  assert.deepEqual(await asUser(a.owner,"select order_id from public.market_cash_payments where order_id=any($1::uuid[])",[orderIds]), [{ order_id: orderA.id }]);
  // Com os mesmos tokens/roles, ACL de coluna bloqueia PII e metadados até
  // em registros próprios ou da loja; a API de servidor ainda pode projetar.
  for (const column of ["recipient_phone","recipient_name","destination_lat","destination_address","assigned_driver_id","idempotency_key","request_fingerprint","catalog_fingerprint","route_geometry"]) {
    await assert.rejects(asUser(a.owner,`select ${column} from public.market_orders where id=$1`,[orderA.id]), { code:"42501" });
  }
  await assert.rejects(asUser(orderA.buyer,"select * from public.market_orders where id=$1",[orderA.id]), { code:"42501" });
  await assert.rejects(asUser(a.owner,"select metadata from public.market_order_events where order_id=$1",[orderA.id]), { code:"42501" });
  await assert.rejects(asUser(a.owner,"select settlement_note from public.market_cash_payments where order_id=$1",[orderA.id]), { code:"42501" });
  const privateOrder = await asRole("service_role","select recipient_phone,request_fingerprint from public.market_orders where id=$1",[orderA.id]);
  assert.equal(privateOrder[0].recipient_phone,delivery.recipientPhone);
  assert.match(privateOrder[0].request_fingerprint,/^[0-9a-f]{64}$/);
  await assert.rejects(asRole("anon","select id from public.market_stores",[]), { code: "42501" });
  await assert.rejects(asUser(a.owner,"update public.market_products set price_cents=1 where id=$1",[a.product]), { code: "42501" });
  await assert.rejects(asUser(a.owner,"select public.market_quote_catalog($1,$2::jsonb)",[a.id,cartOf(a)]), { code: "42501" });
  await assert.rejects(rpc("market_transition_order",[a.owner,orderB.id,"accept",null]), /MARKET_FORBIDDEN/);
  await assert.rejects(rpc("market_manage_store",[a.owner,"saveProduct",a.id,b.product,null,{ category_id: a.category },null]), /MARKET_TARGET_NOT_FOUND/);
});

test("cotação revalida loja, disponibilidade, produto da loja e limites de complementos", async () => {
  const a = await store(), b = await store();
  const quote = await rpc("market_quote_catalog", [a.id,cartOf(a,2)]);
  assert.equal(quote.subtotalCents,2250);
  assert.equal(quote.items[0].options[0].priceCents,125);
  for (const options of [[],[a.option,a.otherOption],[a.option,a.option],[b.option]]) {
    await assert.rejects(rpc("market_quote_catalog",[a.id,cartOf(a,1,options)]), /MARKET_OPTIONS_INVALID/);
  }
  await assert.rejects(rpc("market_quote_catalog",[b.id,cartOf(a)]), /MARKET_PRODUCT_UNAVAILABLE/);
  await query("update public.market_products set active=false where id=$1",[a.product]);
  await assert.rejects(rpc("market_quote_catalog",[a.id,cartOf(a)]), /MARKET_PRODUCT_UNAVAILABLE/);
  await query("update public.market_stores set is_open=false where id=$1",[a.id]);
  await assert.rejects(rpc("market_quote_catalog",[a.id,cartOf(a)]), /MARKET_STORE_CLOSED/);
});

test("checkout rejeita revisão de preço e preserva snapshot; repetição retorna pedido sem consumir estoque", async () => {
  const shop = await store(3), customer = await account();
  const stale = await checkoutInputs(shop,customer,cartOf(shop,2));
  await query("update public.market_products set price_cents=1400 where id=$1",[shop.product]);
  await assert.rejects(rpc("market_checkout",stale.args), /MARKET_CATALOG_CHANGED/);
  assert.equal(await stock(shop.product),3);
  const { args } = await checkoutInputs(shop,customer,cartOf(shop,2));
  const result = await rpc("market_checkout",args);
  assert.equal(result.reused,false);
  assert.equal(await stock(shop.product),1);
  const saved = await row("select product_name,quantity,unit_price_cents,line_total_cents from public.market_order_items where order_id=$1",[result.orderId]);
  assert.deepEqual(saved,{ product_name:"Sanduíche", quantity:2, unit_price_cents:1400, line_total_cents:3050 });
  assert.equal((await order(result.orderId)).total_cents,3050+fare.freightCents);
  await query("update public.market_products set name='Outro nome' where id=$1",[shop.product]);
  await query("update public.market_stores set is_open=false where id=$1",[shop.id]);
  assert.deepEqual(await rpc("market_checkout",args),{ orderId:result.orderId,reused:true });
  const conflict = args.slice();
  conflict[3] = "a".repeat(64);
  await assert.rejects(rpc("market_checkout",conflict), /MARKET_IDEMPOTENCY_CONFLICT/);
  assert.equal(await stock(shop.product),1);
  assert.deepEqual(await row("select product_name,quantity,unit_price_cents,line_total_cents from public.market_order_items where order_id=$1",[result.orderId]),saved);
});

test("estoque soma variações do produto, impede segunda compra sem saldo e libera cancelamento uma vez", async () => {
  const shop = await store(2), a = await account(), b = await account();
  await assert.rejects(rpc("market_quote_catalog",[shop.id,[...cartOf(shop,1),...cartOf(shop,2,[shop.otherOption])]]), /MARKET_STOCK_UNAVAILABLE/);
  const cart = [...cartOf(shop),...cartOf(shop,1,[shop.otherOption])];
  const first = await checkoutInputs(shop,a,cart), competing = await checkoutInputs(shop,b,cart);
  const { orderId } = await rpc("market_checkout",first.args);
  assert.equal(await stock(shop.product),0);
  await assert.rejects(rpc("market_checkout",competing.args), /MARKET_STOCK_UNAVAILABLE/);
  await assert.rejects(rpc("market_cancel_order",[b,orderId,"Não sou o cliente"]), /MARKET_ORDER_NOT_FOUND/);
  assert.equal((await rpc("market_cancel_order",[a,orderId,"Fiz o pedido por engano"])).status,"cancelled");
  await rpc("market_cancel_order",[a,orderId,"Repetição do cancelamento"]);
  assert.equal(await stock(shop.product),2);
  assert.equal((await row("select count(*)::integer as n from public.market_order_events where order_id=$1 and event_type='order.cancelled'",[orderId])).n,1);
});

test("rejeição e expiração pendente liberam estoque; o histórico é registrado uma vez", async () => {
  const shop = await store(3), first = await checkout(shop), second = await checkout(shop);
  assert.equal(await stock(shop.product),1);
  await assert.rejects(rpc("market_transition_order",[shop.owner,first.id,"reject",null]), /MARKET_REASON_REQUIRED/);
  assert.equal((await rpc("market_transition_order",[shop.owner,first.id,"reject","Cozinha indisponível"])).status,"rejected");
  await query("update public.market_orders set expires_at=now()-interval '1 minute' where id=$1",[second.id]);
  await assert.rejects(rpc("market_transition_order",[shop.owner,second.id,"accept",null]), /MARKET_ORDER_EXPIRED/);
  assert.equal(await rpc("market_expire_orders",[50]),1);
  assert.equal(await rpc("market_expire_orders",[50]),0);
  assert.equal((await order(second.id)).status,"cancelled");
  assert.equal(await stock(shop.product),3);
  assert.equal((await row("select count(*)::integer as n from public.market_order_events where order_id=$1 and event_type='order.expired'",[second.id])).n,1);
});

test("pronto aciona preferência sem GPS, recusa cai na rede por retirada, entrega e caixa são separados", async () => {
  await pauseDrivers();
  const shop = await store();
  const preferred = await driver({ gps:false });
  const nearPickup = await driver({ lat:origin.lat+0.0001 });
  const nearDestination = await driver({ lat:delivery.lat,lng:delivery.lng });
  const stale = await driver({ stale:true });
  await query("update public.market_stores set preferred_driver_id=$2 where id=$1",[shop.id,preferred]);
  const { id, buyer } = await checkout(shop);
  assert.equal(await rpc("dispatch_market_order",[id]),false);
  assert.equal(await deliveryRide(id),undefined);
  const normal = await regularRide(buyer);
  await ready(shop,id);
  assert.equal(await rpc("dispatch_market_order",[id]),true);
  const linked = await deliveryRide(id);
  assert.notEqual(normal,linked.id);
  assert.equal(await rpc("dispatch_next_offer",[linked.id]),null);
  assert.equal(await rpc("expire_ride_searches",[linked.id]),0);
  assert.deepEqual(await pendingOffer(linked.id),{ driver_id:preferred,market_dispatch_source:"preferred" });
  assert.deepEqual(await asUser(preferred,"select id from public.rides where id=$1",[linked.id]),[]);
  assert.equal(await rpc("decline_market_delivery",[linked.id,preferred]),id);
  assert.equal(await rpc("dispatch_market_order",[id]),true);
  assert.deepEqual(await pendingOffer(linked.id),{ driver_id:nearPickup,market_dispatch_source:"network" });
  for (const unauthorized of [preferred,nearDestination,stale]) assert.equal(await rpc("accept_market_delivery",[linked.id,unauthorized]),false);
  assert.equal(await rpc("accept_market_delivery",[linked.id,nearPickup]),true);
  assert.equal(await rpc("accept_market_delivery",[linked.id,nearPickup]),true);
  assert.equal((await order(id)).assigned_driver_id,nearPickup);
  assert.deepEqual(await asUser(nearPickup,"select id from public.rides where id=$1",[linked.id]),[{ id:linked.id }]);
  await assert.rejects(cashAction(nearPickup,id,"receive",1125+fare.freightCents), /MARKET_PAYMENT_NOT_READY/);
  // Fixture for movement/arrival verified normally by the driver GPS endpoint.
  await query("update public.rides set status='motorista_a_caminho' where id=$1",[linked.id]);
  await query("update public.rides set status='motorista_chegou',arrival_verified=true,arrived_at=now(),arrival_server_at=now() where id=$1",[linked.id]);
  assert.equal((await rpc("market_driver_delivery_action",[linked.id,nearPickup,"pickup",null,null])).status,"em_corrida");
  assert.equal(await rpc("market_driver_delivery_action",[linked.id,nearPickup,"withdraw","Pneu furado","mechanical"]),null);
  await rpc("market_driver_delivery_action",[linked.id,nearPickup,"exception","Endereço inacessível",null]);
  assert.equal((await order(id)).logistics_status,"exception");
  assert.equal(await rpc("dispatch_market_order",[id]),false);
  assert.equal(await rpc("market_driver_delivery_action",[linked.id,nearPickup,"complete",null,null]),null);
  const admin = await account("admin");
  assert.equal(await rpc("market_admin_delivery_action",[admin,id,"resume","Endereço confirmado pela central"]),true);
  assert.equal((await rpc("market_driver_delivery_action",[linked.id,nearPickup,"complete",null,null])).status,"finalizada");
  assert.equal((await order(id)).status,"delivered");
  assert.deepEqual(await asUser(nearPickup,"select id from public.rides where id=$1",[linked.id]),[]);
  assert.equal((await row("select count(*)::integer as n from public.payments where ride_id=$1",[linked.id])).n,0);
  assert.equal(await stock(shop.product),4);
  const cash = await row("select amount_cents,store_due_cents,driver_due_cents,received_at,settled_at from public.market_cash_payments where order_id=$1",[id]);
  assert.deepEqual(cash,{ amount_cents:1125+fare.freightCents,store_due_cents:1125,driver_due_cents:fare.freightCents,received_at:null,settled_at:null });
  await assert.rejects(cashAction(shop.owner,id,"settle",1125,"recibo-100"), /MARKET_PAYMENT_NOT_RECEIVED/);
  await assert.rejects(cashAction(nearDestination,id,"receive",cash.amount_cents), /MARKET_FORBIDDEN/);
  await assert.rejects(rpc("market_cash_action",[nearPickup,id,"receive",null]), /MARKET_PAYMENT_AMOUNT_REQUIRED/);
  for (const amount of [null,-1,200000001])
    await assert.rejects(cashAction(nearPickup,id,"receive",amount), /MARKET_PAYMENT_AMOUNT_INVALID/);
  const received = await cashAction(nearPickup,id,"receive",cash.amount_cents,null,"Dinheiro conferido");
  assert.ok(received.receivedAt);
  assert.equal(received.receivedAmountCents,cash.amount_cents);
  assert.equal(received.settledAt,null);
  assert.deepEqual(await cashAction(nearPickup,id,"receive",cash.amount_cents,null,"Repetição"),received);
  await assert.rejects(cashAction(nearPickup,id,"receive",cash.amount_cents-1), /MARKET_PAYMENT_CONFLICT/);
  await assert.rejects(cashAction(nearPickup,id,"settle",1125,"recibo-100"), /MARKET_FORBIDDEN/);
  await assert.rejects(cashAction(shop.owner,id,"settle",1125), /MARKET_PAYMENT_REFERENCE_REQUIRED/);
  await assert.rejects(cashAction(shop.owner,id,"settle",1124,"recibo-100"), /MARKET_PAYMENT_AMOUNT_INVALID/);
  const settled = await cashAction(shop.owner,id,"settle",1125,"recibo-100","Repasse conferido");
  assert.ok(settled.settledAt);
  assert.equal(settled.settledAmountCents,1125);
  assert.equal(settled.receivedAt,received.receivedAt);
  assert.deepEqual(await cashAction(shop.owner,id,"settle",1125,"recibo-100"),settled);
  await assert.rejects(cashAction(shop.owner,id,"settle",1125,"recibo-101"), /MARKET_PAYMENT_CONFLICT/);
  assert.deepEqual((await query("select event_type from public.market_order_events where order_id=$1 and event_type like 'payment.%' order by id",[id])).rows.map((item) => item.event_type),
    ["payment.cash_received","payment.store_settled"]);
});

test("caixa legado mantém carimbo e evento sem inventar montantes ou liberar repasse", async () => {
  const { id,courier,owner,receivedAt } = legacyCash;
  const ledger = await row(`select received_at,received_amount_cents,settled_at,settled_amount_cents,amount_cents,store_due_cents
    from public.market_cash_payments where order_id=$1`,[id]);
  assert.equal(new Date(ledger.received_at).getTime(),new Date(receivedAt).getTime());
  assert.equal(ledger.received_amount_cents,null);
  assert.equal(ledger.settled_at,null);
  assert.equal(ledger.settled_amount_cents,null);
  await assert.rejects(cashAction(courier,id,"receive",ledger.amount_cents), /MARKET_PAYMENT_LEGACY_UNVERIFIED/);
  await assert.rejects(cashAction(owner,id,"settle",ledger.store_due_cents,"recibo-legado"), /MARKET_PAYMENT_LEGACY_UNVERIFIED/);
  assert.equal((await row("select count(*)::integer as n from public.market_order_events where order_id=$1 and event_type='payment.cash_received'",[id])).n,1);
});

test("1450 isolada mantém checkout e entrega até o fim e pausa só gravações do caixa", () => {
  assert.equal(cashPreparation.order.status,"delivered");
  assert.equal(cashPreparation.order.logistics_status,"delivered");
  assert.equal(cashPreparation.oldError?.message,"MARKET_PAYMENT_AMOUNT_REQUIRED");
  assert.equal(cashPreparation.newError?.code,"42501");
  assert.deepEqual(cashPreparation.ledger,{
    received_at:null,received_amount_cents:null,settled_at:null,settled_amount_cents:null,
  });
});

test("valor divergente mantém obrigação original e trilha; repasse, estorno e mutações diretas são bloqueados", async () => {
  await pauseDrivers();
  const shop = await store(), courier = await driver();
  const { id } = await checkout(shop);
  await completeOrder(shop,id,courier);
  const original = await row("select amount_cents,store_due_cents from public.market_cash_payments where order_id=$1",[id]);
  await assert.rejects(asRole("service_role","insert into public.market_order_events(order_id,event_type,actor_id) values($1,'payment.cash_received',$2)",[id,courier]), /MARKET_PAYMENT_ACTION_REQUIRED/);
  const recorded = await cashAction(courier,id,"receive",0,"recibo-divergente");
  assert.equal(recorded.receivedAmountCents,0);
  assert.equal(recorded.settledAt,null);
  const movement = await row("select metadata,actor_id from public.market_order_events where order_id=$1 and event_type='payment.cash_received'",[id]);
  assert.deepEqual(movement, { actor_id:courier, metadata:{
    expectedCents:original.amount_cents,reportedCents:0,deltaCents:-original.amount_cents,reference:"recibo-divergente",
  } });
  await assert.rejects(cashAction(shop.owner,id,"settle",original.store_due_cents,"repasse-divergente"), /MARKET_PAYMENT_DIVERGENT/);
  await assert.rejects(cashAction(await account("admin"),id,"refund",0), /MARKET_REFUND_POLICY_NOT_CONFIGURED/);
  await assert.rejects(asRole("service_role","update public.market_orders set subtotal_cents=subtotal_cents+1,total_cents=total_cents+1 where id=$1",[id]), /MARKET_FINANCIAL_SNAPSHOT_IMMUTABLE/);
  await assert.rejects(asRole("service_role","update public.market_order_items set unit_price_cents=1 where order_id=$1",[id]), { code:"42501" });
  await assert.rejects(asRole("service_role","update public.market_cash_payments set received_amount_cents=amount_cents where order_id=$1",[id]), { code:"42501" });
  await assert.rejects(asRole("service_role","delete from public.market_order_events where order_id=$1",[id]), { code:"42501" });
  assert.deepEqual(await row("select amount_cents,store_due_cents,received_amount_cents,settled_amount_cents from public.market_cash_payments where order_id=$1",[id]),{
    ...original,received_amount_cents:0,settled_amount_cents:null,
  });
});

test("preferencial vencido cai na rede pelo worker; desistência antes da retirada redistribui a mesma entrega", async () => {
  await pauseDrivers();
  const shop = await store(), preferred = await driver({ gps:false });
  const firstNetwork = await driver({ lat:origin.lat+0.0001 });
  const secondNetwork = await driver({ lat:origin.lat+0.002 });
  await query("update public.market_stores set preferred_driver_id=$2 where id=$1",[shop.id,preferred]);
  const { id } = await checkout(shop);
  await ready(shop,id);
  assert.equal(await rpc("dispatch_market_order",[id]),true);
  const linked = await deliveryRide(id);
  await query("update public.ride_requests set expires_at=now()-interval '1 second' where ride_id=$1 and driver_id=$2",[linked.id,preferred]);
  await query("update public.market_orders set dispatch_next_at=now()-interval '1 second' where id=$1",[id]);
  assert.equal(await rpc("dispatch_due_market_orders",[25]),1);
  assert.equal((await pendingOffer(linked.id)).driver_id,firstNetwork);
  assert.equal(await rpc("accept_market_delivery",[linked.id,preferred]),false);
  assert.equal(await rpc("accept_market_delivery",[linked.id,firstNetwork]),true);
  await query("insert into public.ride_approach_points(ride_id,driver_id,latitude,longitude,accuracy_meters) values($1,$2,$3,$4,10)",
    [linked.id,firstNetwork,origin.lat,origin.lng]);
  const withdrawn = await rpc("market_driver_delivery_action",[linked.id,firstNetwork,"withdraw","Pneu furado","mechanical"]);
  assert.equal(withdrawn.status,"procurando_motorista");
  assert.equal((await row("select count(*)::integer as n from public.ride_approach_points where ride_id=$1 and driver_id=$2",[linked.id,firstNetwork])).n,0);
  assert.equal(await rpc("dispatch_market_order",[id]),true);
  assert.deepEqual(await pendingOffer(linked.id),{ driver_id:secondNetwork,market_dispatch_source:"network" });
  assert.equal((await deliveryRide(id)).id,linked.id);
  assert.equal((await order(id)).status,"ready");
  assert.equal(await stock(shop.product),4);
  const admin = await account("admin");
  assert.equal(await rpc("market_admin_delivery_action",[admin,id,"cancel","Encerrar o cenário de integração"]),true);
});

test("rede reserva um motoboy por vez e falha de distribuição mantém pedido pronto e sem cobrança", async () => {
  await pauseDrivers();
  const shop = await store(), unavailablePreferred = await driver({ online:false });
  const network = await driver(), stale = await driver({ stale:true });
  await query("update public.market_stores set preferred_driver_id=$2 where id=$1",[shop.id,unavailablePreferred]);
  const first = await checkout(shop), second = await checkout(shop);
  await ready(shop,first.id);
  await ready(shop,second.id);
  assert.equal(await rpc("dispatch_market_order",[first.id]),true);
  assert.equal(await rpc("dispatch_market_order",[second.id]),false);
  const firstRide = await deliveryRide(first.id), secondRide = await deliveryRide(second.id);
  assert.deepEqual(await pendingOffer(firstRide.id),{ driver_id:network,market_dispatch_source:"network" });
  assert.equal(await pendingOffer(secondRide.id),undefined);
  assert.equal(await rpc("accept_market_delivery",[secondRide.id,network]),false);
  assert.equal(await rpc("accept_market_delivery",[secondRide.id,stale]),false);
  assert.equal(await rpc("accept_market_delivery",[firstRide.id,network]),true);
  await query("update public.market_orders set dispatch_attempts=100,dispatch_next_at=now()-interval '1 second' where id=$1",[second.id]);
  assert.equal(await rpc("dispatch_market_order",[second.id]),false);
  const waiting = await order(second.id);
  assert.equal(waiting.status,"ready");
  assert.equal(waiting.logistics_status,"awaiting_driver");
  assert.ok(waiting.dispatch_exhausted_at);
  assert.equal((await row("select received_at from public.market_cash_payments where order_id=$1",[second.id])).received_at,null);
});

test("service_role limpa evidência antiga no redispatch de transporte, sem conceder DELETE a clientes", async () => {
  await pauseDrivers();
  const first = await driver(), replacement = await driver(), buyer = await account();
  const id = await regularRide(buyer);
  assert.equal(await rpc("dispatch_next_offer",[id]),first);
  assert.equal(await rpc("accept_ride",[id,first]),true);
  await query("insert into public.ride_approach_points(ride_id,driver_id,latitude,longitude,accuracy_meters) values($1,$2,$3,$4,10)",
    [id,first,origin.lat,origin.lng]);
  await assert.rejects(asUser(first,"delete from public.ride_approach_points where ride_id=$1",[id]), { code:"42501" });
  const withdrawn = await rpc("driver_cancel_and_redispatch",[id,first,"mechanical","Pneu furado"]);
  assert.equal(withdrawn.status,"procurando_motorista");
  assert.equal((await row("select count(*)::integer as n from public.ride_approach_points where ride_id=$1 and driver_id=$2",[id,first])).n,0);
  assert.equal((await pendingOffer(id)).driver_id,replacement);
});
