import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { parsePublicSiteUrl, parseSupabaseUrl, configuredSecret } from "../lib/config/public-site-url.mjs";
import { pushConfiguration } from "../lib/config/push.ts";
import { assertOnlineConnection } from "../lib/pwa/network.ts";
import { shouldReloadForWorkerChange } from "../lib/pwa/update.ts";
import { discardSubscriptionFromAnotherUser, retirePushSubscription } from "../lib/push/subscription-client.ts";
import { isPublicPushEndpoint } from "../lib/push/endpoint.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");
let db;
let migrations;

async function asAuthenticated(sql, params = []) {
  await db.exec("begin; set local role authenticated;");
  try {
    const result = await db.query(sql, params);
    await db.exec("rollback;");
    return result.rows;
  } catch (error) {
    await db.exec("rollback;");
    throw error;
  }
}

async function account() {
  const id = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [id]);
  return id;
}

function fakeResponse(headers = {}, status = 200, body = "") {
  const response = { ok: status >= 200 && status < 300, status, type: "basic", headers: new Headers(headers), text: async () => body };
  response.clone = () => response;
  return response;
}

async function serviceWorkerHarness(responseHeaders = {}, network = { status: 200 }) {
  const handlers = new Map();
  const cacheStores = new Map();
  const sent = [];
  const opened = [];
  const fetches = [];
  let skipWaitingCount = 0;
  const keyFor = (request) => new URL(request.url || request, "https://app.test").href;
  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const entries = cacheStores.get(name);
      return {
        async addAll(paths) { for (const item of paths) entries.set(keyFor(item), fakeResponse({}, 200,
          item === "/" ? '<script src="/_next/static/chunks/shell.js"></script>' : "")); },
        async put(request, response) { entries.set(keyFor(request), response); },
        async match(request) { return entries.get(keyFor(request)); },
      };
    },
    async keys() { return [...cacheStores.keys()]; },
    async delete(name) { return cacheStores.delete(name); },
    async match(request) {
      for (const entries of cacheStores.values()) if (entries.has(keyFor(request))) return entries.get(keyFor(request));
      return undefined;
    },
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener(name, handler) { handlers.set(name, handler); },
    skipWaiting() { skipWaitingCount += 1; },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url) => { opened.push(url); },
    },
    registration: { showNotification: async (...args) => { sent.push(args); } },
  };
  vm.runInNewContext(await source("public/sw.js"), {
    self, caches, URL, Headers, Response, Promise, AbortSignal,
    fetch: async (request) => {
      const path = request.url || request;
      fetches.push(path);
      if (network.reject) throw new Error("offline");
      return fakeResponse(responseHeaders, network.status,
        path === "/" ? '<script src="/_next/static/chunks/shell.js"></script>' : "");
    },
  });
  return {
    handlers, cacheStores, sent, opened, fetches,
    get skipWaitingCount() { return skipWaitingCount; },
    async fetch(pathname, options = {}) {
      const request = {
        url: `https://app.test${pathname}`,
        method: options.method || "GET",
        mode: options.mode || "cors",
        headers: new Headers(options.headers || {}),
      };
      let handled;
      handlers.get("fetch")({ request, respondWith(promise) { handled = promise; } });
      return handled ? await handled : null;
    },
  };
}

async function clientBundleFiles() {
  const files = [];
  for (const relative of [".next/static", "dist/client"]) {
    const directory = path.join(root, relative);
    assert.equal((await stat(directory)).isDirectory(), true, `Build cliente ausente: ${relative}`);
    const visit = async (current) => {
      for (const item of await readdir(current, { withFileTypes: true })) {
        const target = path.join(current, item.name);
        if (item.isDirectory()) await visit(target);
        else if (item.isFile()) files.push(target);
      }
    };
    await visit(directory);
  }
  return files;
}

function privateValuesFromLocalEnv() {
  return readFile(path.join(root, ".env.local"), "utf8")
    .then((contents) => contents.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter(Boolean).filter((match) => ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "PUSH_DISPATCH_SECRET"].includes(match[1]) || /^PIX_.*(?:KEY|SECRET|TOKEN)$/.test(match[1]))
      .map((match) => match[2].trim().replace(/^(["'])(.*)\1$/, "$2"))
      .filter((value) => value.length >= 12 && configuredSecret(value)))
    .catch(() => []);
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create publication supabase_realtime;`);
  const directory = path.join(root, "supabase", "migrations");
  migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of migrations) await db.exec(await readFile(path.join(directory, file), "utf8"));
});
after(async () => db?.close());

test("1. manifest PWA válido e identificado como MotoPombal", async () => {
  const manifest = JSON.parse(await source("public/manifest.webmanifest"));
  assert.equal(manifest.name, "MotoPombal");
  assert.ok(manifest.short_name);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});
test("2. ícones referenciados existem com PNG e dimensões declaradas", async () => {
  const manifest = JSON.parse(await source("public/manifest.webmanifest"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    const file = path.resolve(root, "public", icon.src.slice(1));
    assert.ok(file.startsWith(path.resolve(root, "public") + path.sep));
    const buffer = await readFile(file);
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(buffer.readUInt32BE(16), width);
    assert.equal(buffer.readUInt32BE(20), height);
  }
  assert.equal((await readFile(path.join(root, "public/icons/apple-touch-icon.png"))).readUInt32BE(16), 180);
});
test("3. SW registra em produção com escopo raiz e atualização sem cache HTTP", async () => {
  const code = await source("components/pwa-register.tsx");
  assert.match(code, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(code, /scope: "\/"/);
  assert.match(code, /updateViaCache: "none"/);
  assert.match(code, /process\.env\.NODE_ENV !== "production"/);
});
test("4. API autenticada não é interceptada pelo cache", async () => {
  const worker = await serviceWorkerHarness();
  assert.equal(await worker.fetch("/api/notifications", { headers: { authorization: "Bearer fake" } }), null);
  assert.equal(worker.fetches.length, 0);
});
test("5. resposta de corrida não entra no cache", async () => {
  const worker = await serviceWorkerHarness();
  assert.equal(await worker.fetch("/api/rides/active"), null);
  assert.equal(worker.cacheStores.size, 0);
});
test("6. pagamento não entra no cache", async () => {
  const worker = await serviceWorkerHarness();
  assert.equal(await worker.fetch("/api/payments/cash"), null);
});
test("7. administração não entra no cache", async () => {
  const worker = await serviceWorkerHarness();
  assert.equal(await worker.fetch("/api/admin/finance"), null);
  assert.equal(await worker.fetch("/admin/export.js"), null);
});
test("8. asset permitido é cacheado; resposta private não é", async () => {
  const buildId = (await source("public/sw.js")).match(/const SW_BUILD_ID = "([^"]+)"/)?.[1];
  const staticCacheName = `moto-pombal-static-${buildId}`;
  assert.ok(staticCacheName);
  const allowed = await serviceWorkerHarness();
  await allowed.fetch("/_next/static/chunk.js");
  assert.equal(allowed.cacheStores.get(staticCacheName)?.size, 1);
  const privateWorker = await serviceWorkerHarness({ "cache-control": "private, no-store" });
  await privateWorker.fetch("/_next/static/chunk.js");
  assert.equal(privateWorker.cacheStores.get(staticCacheName)?.size, 0);
  allowed.cacheStores.set("moto-vip-static-v7", new Map());
  allowed.cacheStores.set("other-app-cache", new Map());
  let activation;
  allowed.handlers.get("activate")({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.equal(allowed.cacheStores.has("moto-vip-static-v7"), false);
  assert.equal(allowed.cacheStores.has("other-app-cache"), true);
});
test("8a. instalação guarda os chunks iniciais e abertura usa shell em falha de rede", async () => {
  const buildId = (await source("public/sw.js")).match(/const SW_BUILD_ID = "([^"]+)"/)?.[1];
  const staticCacheName = `moto-pombal-static-${buildId}`;
  assert.ok(staticCacheName);
  const network = { status: 200 };
  const worker = await serviceWorkerHarness({}, network);
  let installing;
  worker.handlers.get("install")({ waitUntil(promise) { installing = promise; } });
  await installing;
  assert.ok(worker.cacheStores.get(staticCacheName)?.has("https://app.test/_next/static/chunks/shell.js"));
  assert.equal(worker.skipWaitingCount, 0, "o SW novo deve aguardar o botão ATUALIZAR");
  worker.handlers.get("message")({ data: { type: "SKIP_WAITING" } });
  assert.equal(worker.skipWaitingCount, 1);
  network.status = 503;
  assert.equal((await worker.fetch("/", { mode: "navigate" })).ok, true);
  network.status = 404;
  assert.equal((await worker.fetch("/_next/static/chunks/shell.js")).ok, true);
});
test("8b. primeira instalação do SW não força recarga da página", async () => {
  const code = await source("components/pwa-register.tsx");
  assert.match(code, /if \(!updateRequested\.current \|\| reloading\.current \|\| !navigator\.onLine\) return/);
});
test("9. atualização do SW não recarrega em loop", () => {
  assert.equal(shouldReloadForWorkerChange(null, 100_000), true);
  assert.equal(shouldReloadForWorkerChange("100000", 100_100), false);
  assert.equal(shouldReloadForWorkerChange("100000", 116_000), true);
});
test("10. sem internet, solicitação de corrida é bloqueada antes do fetch", async () => {
  assert.throws(() => assertOnlineConnection(false), /Sem conexão/);
  const hook = await source("hooks/use-moto-vip.ts");
  assert.match(hook, /assertOnlineConnection\(navigator\.onLine\)/);
  assert.match(hook, /requestRide: async[\s\S]*?api<\{ ride: Ride \}>\("\/api\/rides\/request"/);
});
test("11. sem internet, aceite de oferta é bloqueado pelo mesmo gate", async () => {
  assert.throws(() => assertOnlineConnection(false), /Sem conexão/);
  assert.match(await source("hooks/use-moto-vip.ts"), /acceptRide:[\s\S]*?api\(`\/api\/rides\/\$\{rideId\}\/accept`/);
});
test("12. reconexão apenas ressincroniza; não reenvia corrida ou dinheiro", async () => {
  const hook = await source("hooks/use-moto-vip.ts");
  const sync = hook.slice(hook.indexOf("const synchronize ="), hook.indexOf('window.addEventListener("focus"'));
  assert.match(sync, /refresh\(session\)/);
  assert.doesNotMatch(sync, /requestRide|acceptRide|confirmCashPayment/);
  assert.match(await source("components/pwa-register.tsx"), /moto-vip:network-restored/);
});
test("13. Push sem VAPID e despachante retorna não configurado", () => {
  const result = pushConfiguration({});
  assert.equal(result.configured, false);
  assert.ok(result.missing.includes("VAPID_PRIVATE_KEY"));
  assert.ok(result.missing.includes("PUSH_DISPATCH_SECRET"));
  const placeholders = pushConfiguration({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "SUBSTITUA_AQUI",
    VAPID_PRIVATE_KEY: "YOUR_SECRET",
    VAPID_SUBJECT: "mailto:contato@SEU-DOMINIO",
    PUSH_DISPATCH_SECRET: "YOUR_SECRET",
  });
  assert.equal(placeholders.configured, false);
  assert.ok(placeholders.missing.includes("VAPID_PRIVATE_KEY"));
});
test("14. VAPID private não consta nos bundles públicos", async () => {
  const values = await privateValuesFromLocalEnv();
  const privateKey = values.find((value) => value.length >= 40);
  for (const file of await clientBundleFiles()) {
    const contents = await readFile(file);
    assert.equal(contents.includes(Buffer.from("VAPID_PRIVATE_KEY")), false, "Nome da chave privada presente no bundle cliente.");
    if (privateKey) assert.equal(contents.includes(Buffer.from(privateKey)), false, "Chave privada presente no bundle cliente.");
  }
});
test("15. subscription não pode ser gravada para outro usuário", async () => {
  const owner = await account();
  await assert.rejects(asAuthenticated("insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,'https://push.example.test/a','key','auth')", [owner]), /permission denied|permiss/i);
  const route = await source("app/api/push/subscribe/route.ts");
  assert.match(route, /user_id: user\.id/);
  assert.match(route, /\.strict\(\)/);
  assert.equal(isPublicPushEndpoint("https://push.example.test/abc"), true);
  assert.equal(isPublicPushEndpoint("http://127.0.0.1/internal"), false);
});
test("16. endpoint inválido é desativado e não recebe tentativas eternas", async () => {
  const owner = await account();
  const id = randomUUID();
  await db.query("insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values ($1,$2,$3,'key','auth')", [id, owner, `https://push.example.test/${id}`]);
  await db.query("update public.push_subscriptions set active=false where id=$1", [id]);
  assert.equal((await db.query("select active from public.push_subscriptions where id=$1", [id])).rows[0].active, false);
  const dispatcher = await source("lib/backend/push.ts");
  assert.match(dispatcher, /statusCode === 404 \|\| pushError\.statusCode === 410/);
  assert.match(dispatcher, /update\(\{ active: false \}\)/);
});
test("17. logout e troca de conta desfazem inscrição sem misturar usuários", async () => {
  let unsubscribed = 0;
  const subscription = { endpoint: "https://push.example.test/device", unsubscribe: async () => { unsubscribed += 1; return true; } };
  assert.equal(await retirePushSubscription(subscription, async () => { throw new Error("offline"); }), true);
  assert.equal(await discardSubscriptionFromAnotherUser("old-user", "new-user", subscription), true);
  assert.equal(unsubscribed, 2);
  assert.match(await source("hooks/use-moto-vip.ts"), /signOut: async[\s\S]*?retirePushSubscription/);
});
test("18. Push antigo abre notificações e busca estado atual no backend", async () => {
  const worker = await serviceWorkerHarness();
  let work;
  worker.handlers.get("notificationclick")({
    notification: { data: { url: "https://outro.test/", rideId: randomUUID() }, close() {} },
    waitUntil(promise) { work = promise; },
  });
  await work;
  assert.deepEqual(worker.opened, ["/?open=notifications"]);
  assert.match(await source("app/page.tsx"), /backendRef\.current\.refresh\(\)\.catch\(.*\)\.finally/);
});
test("19. Push apenas alerta; não altera corrida nem pagamento", async () => {
  const worker = await serviceWorkerHarness();
  let work;
  worker.handlers.get("push")({
    data: { json: () => ({ title: "Oferta", body: "Consulte o app", data: { rideId: randomUUID() } }) },
    waitUntil(promise) { work = promise; },
  });
  await work;
  assert.equal(worker.sent.length, 1);
  assert.equal(worker.fetches.length, 0);
  assert.doesNotMatch(await source("public/sw.js"), /fetch\([^)]*method:\s*["']POST/);
});
test("20. Push e Realtime usam um único registro de notificação do domínio", async () => {
  const user = await account();
  await db.query("insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,'key','auth')", [user, `https://push.example.test/${randomUUID()}`]);
  const notificationId = randomUUID();
  await db.query("insert into public.notifications(id,user_id,type,title,body) values ($1,$2,'ride.offer','Oferta','Nova oferta')", [notificationId, user]);
  assert.equal((await db.query("select count(*)::integer as n from public.notifications where id=$1", [notificationId])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::integer as n from public.notification_push_deliveries where notification_id=$1", [notificationId])).rows[0].n, 1);
});
test("21. configuração crítica ausente falha de forma controlada", () => {
  assert.throws(() => parseSupabaseUrl(undefined), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.throws(() => parsePublicSiteUrl(undefined, { required: true }), /NEXT_PUBLIC_SITE_URL/);
  assert.equal(configuredSecret("sb_secret_SUBSTITUA_AQUI"), false);
});
test("22. nomes de segredos de servidor não usam NEXT_PUBLIC", async () => {
  for (const name of ["SUPABASE_SECRET_KEY", "VAPID_PRIVATE_KEY", "PUSH_DISPATCH_SECRET"]) assert.equal(name.startsWith("NEXT_PUBLIC_"), false);
  const client = (await source("hooks/use-moto-vip.ts")) + (await source("lib/supabase/client.ts"));
  assert.doesNotMatch(client, /process\.env\.(?:SUPABASE_SECRET_KEY|VAPID_PRIVATE_KEY|PUSH_DISPATCH_SECRET)/);
});
test("23. URL canônica possui uma única fonte e não aceita domínio fictício", async () => {
  assert.throws(() => parsePublicSiteUrl("https://moto.example.org"), /NEXT_PUBLIC_SITE_URL/);
  assert.equal(parsePublicSiteUrl("https://moto-syxp.test"), "https://moto-syxp.test");
  assert.throws(() => parsePublicSiteUrl("http://moto-syxp.test"), /HTTPS/);
  assert.match(await source("app/layout.tsx"), /parsePublicSiteUrl\(process\.env\.NEXT_PUBLIC_SITE_URL\)/);
});
test("24. migrations executam desde zero; segurança precede as etapas da fila", () => {
  assert.ok(migrations.indexOf("20260929100000_stage7_financial_consistency.sql") < migrations.indexOf("20260929110000_stage8_security_admin.sql"));
  assert.ok(migrations.indexOf("20260929110000_stage8_security_admin.sql") >= 0);
  assert.ok(migrations.indexOf("20260929110000_stage8_security_admin.sql") < migrations.indexOf("20260930120000_dispatch_queue_without_radius.sql"));
  assert.ok(migrations.indexOf("20260930120000_dispatch_queue_without_radius.sql") < migrations.indexOf("20260930130000_driver_queue_visibility.sql"));
});
test("25. build público não contém valor privado conhecido", async () => {
  const secrets = await privateValuesFromLocalEnv();
  for (const file of await clientBundleFiles()) {
    const contents = await readFile(file);
    for (const secret of secrets) assert.equal(contents.includes(Buffer.from(secret)), false, "Segredo privado presente no bundle cliente.");
  }
});
