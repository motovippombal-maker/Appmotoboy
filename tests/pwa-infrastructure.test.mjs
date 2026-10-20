import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = process.cwd();
const workerSource = await readFile(path.join(root, "public/sw.js"), "utf8");
const currentBuild = workerSource.match(/const SW_BUILD_ID = "([^"]+)"/)?.[1];
const currentStatic = `moto-pombal-static-${currentBuild}`;
const previousStatic = "moto-pombal-static-bbbbbbbbbbbb";
const olderStatic = "moto-pombal-static-aaaaaaaaaaaa";

function fakeResponse(headers = {}) {
  const response = { ok: true, status: 200, type: "basic", headers: new Headers(headers) };
  response.clone = () => response;
  return response;
}

function workerHarness(names = [], responseHeaders = {}) {
  const handlers = new Map();
  const stores = new Map(names.map((name) => [name, new Map()]));
  const network = { offline: false };
  const keyFor = (request) => new URL(request.url || request, "https://app.test").href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        put: async (request, response) => entries.set(keyFor(request), response),
        match: async (request) => entries.get(keyFor(request)),
      };
    },
    match: async (request) => {
      for (const entries of stores.values()) if (entries.has(keyFor(request))) return entries.get(keyFor(request));
    },
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (event, callback) => handlers.set(event, callback),
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(workerSource, {
    self, caches, URL, Headers, Response, Promise, AbortSignal,
    fetch: async () => {
      if (network.offline) throw new Error("offline");
      return fakeResponse(responseHeaders);
    },
  });
  return {
    stores, network,
    activate: async () => {
      let activation;
      handlers.get("activate")({ waitUntil: (promise) => { activation = promise; } });
      await activation;
    },
    fetch: async (pathname, options = {}) => {
      let handled;
      const request = {
        url: `https://app.test${pathname}`,
        method: options.method || "GET",
        mode: "cors",
        headers: new Headers(options.headers || {}),
      };
      handlers.get("fetch")({ request, respondWith: (promise) => { handled = promise; } });
      return handled ? await handled : null;
    },
  };
}

test("PWA keeps the previous hash generation and removes older app caches", async () => {
  const names = [olderStatic, previousStatic, currentStatic, "moto-pombal-shell-aaaaaaaaaaaa", "moto-pombal-region-packages", "other-app-cache"];
  const worker = workerHarness(names);
  await worker.activate();
  assert.equal(worker.stores.has(currentStatic), true);
  assert.equal(worker.stores.has(previousStatic), true);
  assert.equal(worker.stores.has(olderStatic), false);
  assert.equal(worker.stores.has("moto-pombal-shell-aaaaaaaaaaaa"), false);
  assert.equal(worker.stores.has("moto-pombal-region-packages"), true);
  assert.equal(worker.stores.has("other-app-cache"), true);
  assert.equal([...worker.stores.keys()].filter((name) => name.startsWith("moto-pombal-static-")).length, 2);
});

test("PWA retains only the latest legacy generation during migration", async () => {
  const worker = workerHarness(["moto-pombal-static-v11", "moto-pombal-static-v12", "moto-vip-static-v7", "moto-syxp-shell-v2", currentStatic]);
  await worker.activate();
  assert.equal(worker.stores.has("moto-pombal-static-v12"), true);
  assert.equal(worker.stores.has("moto-pombal-static-v11"), false);
  assert.equal(worker.stores.has("moto-vip-static-v7"), false);
  assert.equal(worker.stores.has("moto-syxp-shell-v2"), false);
});

test("PWA bounds mixed legacy and hash caches by creation order", async () => {
  const worker = workerHarness(["moto-pombal-static-v12", olderStatic, previousStatic, currentStatic]);
  await worker.activate();
  assert.deepEqual([...worker.stores.keys()], [previousStatic, currentStatic]);
});

test("a tab from the previous build can retrieve its cached chunk offline", async () => {
  const worker = workerHarness([olderStatic, previousStatic, currentStatic]);
  const chunk = fakeResponse();
  worker.stores.get(previousStatic).set("https://app.test/_next/static/previous-chunk.js", chunk);
  await worker.activate();
  worker.network.offline = true;
  assert.equal(await worker.fetch("/_next/static/previous-chunk.js"), chunk);
});

test("retaining a generation keeps APIs and authenticated requests outside the cache", async () => {
  const worker = workerHarness([previousStatic, currentStatic]);
  await worker.activate();
  for (const url of ["/api/rides/active", "/api/admin/rides", "/api/payments/pix"]) assert.equal(await worker.fetch(url), null);
  assert.equal(await worker.fetch("/_next/static/chunk.js", { headers: { authorization: "Bearer test" } }), null);
  assert.equal(await worker.fetch("/_next/static/chunk.js", { method: "POST" }), null);
  const privateWorker = workerHarness([previousStatic, currentStatic], { "cache-control": "private, no-store" });
  await privateWorker.activate();
  await privateWorker.fetch("/_next/static/chunk.js");
  assert.equal(privateWorker.stores.get(currentStatic).size, 0);
});

test("both build targets stamp once and development leaves the worker unchanged", async () => {
  const workRoot = path.resolve(root, "work");
  await mkdir(workRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(workRoot, "pwa-build-test-"));
  try {
    await mkdir(path.join(fixtureRoot, "scripts"));
    await mkdir(path.join(fixtureRoot, "public"));
    await mkdir(path.join(fixtureRoot, "node_modules/vinext/dist"), { recursive: true });
    for (const name of ["run-framework.mjs", "stamp-service-worker.mjs", "execution-profile.mjs"]) {
      await writeFile(path.join(fixtureRoot, "scripts", name), await readFile(path.join(root, "scripts", name)));
    }
    await writeFile(path.join(fixtureRoot, "node_modules/vinext/dist/cli.js"), "process.stdout.write('bundler called\\n');\n");
    const fixtureWorker = path.join(fixtureRoot, "public/sw.js");
    const run = (script, args = []) => {
      const result = spawnSync(process.execPath, [path.join(fixtureRoot, "scripts", script), ...args], { cwd: fixtureRoot, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    await writeFile(fixtureWorker, workerSource);
    const buildOutput = run("run-framework.mjs", ["build"]);
    const vinextWorker = await readFile(fixtureWorker, "utf8");
    const vinextId = vinextWorker.match(/const SW_BUILD_ID = "([^"]+)"/)?.[1];
    assert.match(vinextId, /^[a-f0-9]{12}$/);
    assert.notEqual(vinextId, currentBuild);
    assert.equal(buildOutput.match(/Service worker preparado/g)?.length, 1);
    assert.equal(vinextWorker.replace(vinextId, currentBuild), workerSource);
    run("run-framework.mjs", ["dev"]);
    assert.equal(await readFile(fixtureWorker, "utf8"), vinextWorker);
    const vercelOutput = run("stamp-service-worker.mjs");
    const vercelId = (await readFile(fixtureWorker, "utf8")).match(/const SW_BUILD_ID = "([^"]+)"/)?.[1];
    assert.notEqual(vercelId, vinextId);
    assert.equal(vercelOutput.match(/Service worker preparado/g)?.length, 1);
    const { scripts } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(scripts["build:vercel"].match(/stamp-service-worker\.mjs/g)?.length, 1);
    assert.match(scripts["build:vercel"], /stamp-service-worker\.mjs && next build/);
    assert.match(scripts.build, /run-framework\.mjs build/);
  } finally {
    assert.ok(path.resolve(fixtureRoot).startsWith(workRoot + path.sep));
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
