// In-memory PGlite only. No application credentials, network or Push provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { before, after, test } from "node:test";

let db;
let legacyEndpoint;
const migrations = new URL("../supabase/migrations/", import.meta.url);
const roles = { buyer: "passenger", merchant: "passenger", admin: "admin", stranger: "passenger" };
const actors = {};
const environmentId = "794382dd-bec6-4420-9745-56c27410e718";
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('market_notice.test_user',true),'')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema auth to anon,authenticated,service_role;
    create publication supabase_realtime;
  `);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === "20261115143000_marketplace_notifications_and_push.sql") {
      for (const [label, role] of Object.entries(roles)) {
        actors[label] = randomUUID();
        await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)", [
          actors[label], `${label}-notices@example.test`, { role, full_name: "Conta sintética" },
        ]);
        if (role === "admin") await db.query("update public.profiles set role='admin' where id=$1",[actors[label]]);
      }
      legacyEndpoint = "https://push.example.test/old-device";
      for (const actor of [actors.buyer, actors.merchant]) {
        await db.query("insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,'p','a')", [actor, legacyEndpoint]);
      }
      await db.query("update public.push_subscriptions set updated_at=now()+interval '1 minute' where user_id=$1",[actors.merchant]);
    }
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
});
after(async () => { await db?.close(); });

test("migration preserves old subscriptions and reduces active duplicates to one", async () => {
  const { rows } = await db.query("select user_id,active from public.push_subscriptions where endpoint=$1 order by active desc", [legacyEndpoint]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].active, true);
  assert.equal(rows[1].active, false);
  assert.equal((await row("select count(*)::int as count from public.push_subscriptions where endpoint=$1 and active",[legacyEndpoint])).count, 1);
  await assert.rejects(db.query("update public.push_subscriptions set active=true where endpoint=$1 and not active", [legacyEndpoint]), { code: "23505" });
});

test("service-role RPC atomically switches the endpoint owner without granting registration to the caller", async () => {
  const endpoint = "https://push.example.test/new-device";
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select public.register_push_subscription($1,$2,'p','a','test')",[actors.merchant,endpoint]), { code: "42501" });
  } finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try {
    for (const actor of [actors.buyer,actors.merchant,actors.merchant])
      await db.query("select public.register_push_subscription($1,$2,'p','a','test')",[actor,endpoint]);
  } finally { await db.exec("reset role"); }
  assert.deepEqual((await db.query("select user_id from public.push_subscriptions where endpoint=$1 and active",[endpoint])).rows,[{ user_id: actors.merchant }]);
});

test("one committed order event fans out one sanitized inbox/outbox record per authorized recipient", async () => {
  const { id: storeId } = await row(`insert into public.market_stores(slug,name,category,address,latitude,longitude)
    values('synthetic-market','Loja de teste','Mercado','Retirada sintética',-10.8,-38.5) returning id`);
  // The admin is also in the store: one event must not produce two alerts for this account.
  for (const actor of [actors.merchant,actors.admin])
    await db.query("insert into public.market_store_members(store_id,user_id,role) values($1,$2,'owner')",[storeId,actor]);
  for (const [label,actor] of Object.entries(actors))
    await db.query("select public.register_push_subscription($1,$2,'p','a','test')",[actor,`https://push.example.test/${label}`]);
  const createOrder = () => row(`insert into public.market_orders(store_id,customer_id,idempotency_key,request_fingerprint,catalog_fingerprint,
    store_name,pickup_address,pickup_lat,pickup_lng,destination_address,destination_lat,destination_lng,recipient_name,recipient_phone,
    subtotal_cents,freight_cents,total_cents,fare_rule_snapshot) values($1,$2,$3,repeat('a',64),repeat('b',64),
    'Loja de teste','Retirada sintética',-10.8,-38.5,'Endereço privado',-10.81,-38.51,'Pessoa sintética','+5575999999999',1000,500,1500,'{}') returning id`,
  [storeId,actors.buyer,randomUUID()]);
  const allowed = async (mode, id = environmentId) => (await row("select public.market_confirm_operation_environment($1,$2) as allowed", [id,mode])).allowed;
  assert.equal(await allowed("production"), false);
  await assert.rejects(createOrder(), /MARKETPLACE_OPERATIONS_PAUSED/);
  assert.equal((await row("select count(*)::int as count from public.market_orders")).count, 0);
  await db.exec("set role service_role");
  try {
    await assert.rejects(db.query("insert into private.marketplace_operation_environment values (true,'production',$1,true)", [environmentId]), { code: "42501" });
  } finally { await db.exec("reset role"); }
  await db.query("insert into private.marketplace_operation_environment(singleton,operation_mode,environment_id) values(true,'production',$1)", [environmentId]);
  assert.equal(await allowed("production"), false);
  await assert.rejects(createOrder(), /MARKETPLACE_OPERATIONS_PAUSED/);
  await db.exec("update private.marketplace_operation_environment set enabled=true where singleton");
  assert.equal(await allowed("production"), true);
  assert.equal(await allowed("isolated_test"), false);
  assert.equal(await allowed("production", randomUUID()), false);
  const { id: orderId } = await createOrder();
  await db.query("begin");
  const transient = await row("insert into public.market_order_events(order_id,event_type) values($1,'dispatch_waiting_support') returning id",[orderId]);
  await db.query("rollback");
  assert.equal((await row("select count(*)::int as count from public.notifications where market_order_event_id=$1",[transient.id])).count,0);
  const event = await row("insert into public.market_order_events(order_id,event_type,metadata) values($1,'dispatch_waiting_support','{\"reason\":\"nota privada\"}') returning id",[orderId]);
  const { rows } = await db.query("select id,user_id,data from public.notifications where market_order_event_id=$1",[event.id]);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map((notice) => notice.user_id).sort(), [actors.admin,actors.buyer,actors.merchant].sort());
  for (const notice of rows) {
    assert.deepEqual(Object.keys(notice.data).sort(),["audience","orderId"]);
    assert.equal(notice.data.orderId,orderId);
  }
  // Merchant has 3 active endpoints, buyer and admin one apiece; each is a unique delivery.
  assert.equal((await row(`select count(*)::int as count from public.notification_push_deliveries d
    join public.notifications n on n.id=d.notification_id where n.market_order_event_id=$1`,[event.id])).count,5);
  await db.query("select set_config('market_notice.test_user',$1,false)",[actors.stranger]);
  await db.exec("set role authenticated");
  try {
    assert.equal((await row("select count(*)::int as count from public.notifications where market_order_event_id=$1",[event.id])).count,0);
  } finally { await db.exec("reset role"); }
  await db.exec("update private.marketplace_operation_environment set enabled=false where singleton");
  assert.equal(await allowed("production"), false);
  await assert.rejects(db.query("update public.market_orders set status='preparing' where id=$1", [orderId]), /MARKETPLACE_OPERATIONS_PAUSED/);
  await db.query("update public.market_orders set status='cancelled' where id=$1", [orderId]);
});
