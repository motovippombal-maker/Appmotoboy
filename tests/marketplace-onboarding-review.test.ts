import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { ApiError } from "../lib/backend/errors";
import { requireManageStore, requirePreferredDriverStore } from "../lib/backend/marketplace-management-access";
import { filterStoresForReview, isStoreReadinessRpcMissing, parseStoreReadiness } from "../lib/marketplace/store-onboarding-review";

const storeId = "00000000-0000-4000-8000-000000000001";
const otherStoreId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const fixtures = [
  { id: storeId, slug: "acai-do-centro", name: "Açaí do Centro", status: "pending" as const, active: false, is_open: true },
  { id: otherStoreId, slug: "mercado-central", name: "Mercado Central", status: "approved" as const, active: true, is_open: false },
  { id: "00000000-0000-4000-8000-000000000004", slug: "loja-suspensa", name: "Loja Suspensa", status: "suspended" as const, active: true, is_open: true },
  { id: "00000000-0000-4000-8000-000000000005", slug: "aprovada-inativa", name: "Aprovada Inativa", status: "approved" as const, active: false, is_open: true },
];

function script(relative: string, name: string) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const found = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found);
  return ts.transpileModule(found.getText(parsed).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

function authFixture(status: "pending" | "approved" | "suspended" = "pending", active = false) {
  let reads = 0;
  const client = {
    from(table: string) {
      const fields = new Map<string, unknown>();
      const query = { select: () => query, eq(column: string, value: unknown) { fields.set(column, value); return query; }, async maybeSingle() {
        reads++;
        if (table === "market_store_members") return { data: fields.get("store_id") === storeId && fields.get("user_id") === userId ? { role: "owner" } : null, error: null };
        assert.equal(table, "market_stores");
        return { data: { id: fields.get("id"), status, active }, error: null };
      } };
      return query;
    },
  };
  const auth = { user: { id: userId }, profile: { role: "passenger", blocked: false }, supabase: client } as unknown as Parameters<typeof requireManageStore>[0];
  return { auth, reads: () => reads };
}

test("central encontra pendentes por situação, nome ou slug sem reordenar os cadastros", () => {
  assert.deepEqual(filterStoresForReview(fixtures, "pending", "  ACAI  CENTRO "), [fixtures[0]]);
  assert.deepEqual(filterStoresForReview(fixtures, "", "central"), [fixtures[1]]);
  assert.deepEqual(filterStoresForReview(fixtures, "approved", ""), [fixtures[1], fixtures[3]]);
  assert.deepEqual(filterStoresForReview(fixtures, "suspended", "não existe"), []);
});

test("pendência automática é interpretada sem declarar pronto um schema ou payload ausente", () => {
  assert.deepEqual(parseStoreReadiness({ required: true, ready: false, issues: ["owner", "catalog"] }), { required: true, ready: false, issues: ["owner", "catalog"] });
  assert.deepEqual(parseStoreReadiness({ required: false, ready: true, issues: [] }), { required: false, ready: true, issues: [] });
  for (const value of [null, {}, { required: true, ready: true, issues: ["owner"] }, { required: true, ready: false, issues: [] },
    { required: false, ready: false, issues: ["catalog"] }, { required: true, ready: false, issues: ["unknown"] }])
    assert.equal(parseStoreReadiness(value), null);
});

test("titular prepara sua loja pendente sem permissão em outro estabelecimento ou vínculo de motoboy", async () => {
  const pending = authFixture();
  assert.equal(await requireManageStore(pending.auth, storeId), "owner");
  await assert.rejects(requireManageStore(pending.auth, otherStoreId), (error: unknown) => error instanceof ApiError && error.status === 403);
  await assert.rejects(requirePreferredDriverStore(pending.auth, storeId), (error: unknown) => error instanceof ApiError && error.code === "MARKET_STORE_NOT_APPROVED");
  const inactive = authFixture("approved", false);
  await assert.rejects(requirePreferredDriverStore(inactive.auth, storeId), (error: unknown) => error instanceof ApiError && error.status === 403);
  await requirePreferredDriverStore(authFixture("approved", true).auth, storeId);
});

test("lista pública só mostra loja aprovada e ativa; abrir manualmente um cadastro pendente não publica", async () => {
  const read = new Map<string, unknown>();
  const supabase = {
    from(table: string) {
      assert.equal(table, "market_stores");
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { read.set(column, value); return query; },
        order: () => query,
        limit: async () => ({ data: fixtures.filter((row) => [...read].every(([column, value]) => row[column as keyof typeof row] === value)), error: null }),
      };
      return query;
    },
    async rpc(name: string, args: { p_store_ids: string[] }) {
      assert.equal(name, "market_store_open_statuses");
      assert.deepEqual(args.p_store_ids, [otherStoreId]);
      return { data: [{ id: otherStoreId, is_open: false }], error: null };
    },
  };
  const context = createContext({ z, URL, request: { url: "https://moto.test/api/marketplace/stores" },
    createSupabaseAdminClient: () => supabase, MARKET_STORE_FIELDS: "id,slug,name", marketResponse: (data: unknown) => data,
    jsonError: (problem: unknown) => { throw problem; }, throwMarketError: (problem: unknown) => { throw problem; } });
  runInContext(script("../app/api/marketplace/stores/route.ts", "GET"), context);
  const result = await runInContext("GET(request)", context);
  assert.equal(result.stores.length, 1);
  assert.equal(result.stores[0].id, otherStoreId);
  assert.equal(result.stores[0].open, false);
  assert.equal(read.get("status"), "approved");
  assert.equal(read.get("active"), true);
});

test("GET de revisão usa ator autenticado e só trata ausência específica da RPC como compatibilidade", async () => {
  const fixture = authFixture();
  const calls: { p_actor_id: string; p_store_id: string }[] = [];
  const run = async (error: { code: string; message: string } | null) => {
    const context = createContext({ auth: fixture.auth, storeId, requireManageStore, parseStoreReadiness, isStoreReadinessRpcMissing,
      managementError: (problem: { code: string } | null) => { if (problem) throw new ApiError(403, "Sem permissão", problem.code); } });
    fixture.auth.supabase.rpc = (async (_name: string, args: { p_actor_id: string; p_store_id: string }) => {
      calls.push(args);
      return { data: { required: true, ready: false, issues: ["catalog"] }, error };
    }) as unknown as typeof fixture.auth.supabase.rpc;
    runInContext(script("../lib/backend/marketplace-management.ts", "loadStoreReadiness"), context);
    return await runInContext("loadStoreReadiness(auth, storeId)", context);
  };
  assert.equal(await run({ code: "PGRST202", message: "Could not find the function public.market_store_readiness(p_actor_id, p_store_id) in the schema cache" }), null);
  assert.equal(await run(null).then((result) => result.ready), false);
  await assert.rejects(run({ code: "42501", message: "permission denied for function market_store_readiness" }), (error: unknown) => error instanceof ApiError && error.status === 403);
  assert.equal(calls.every((args) => args.p_actor_id === userId && args.p_store_id === storeId), true);
  assert.equal(isStoreReadinessRpcMissing({ code: "PGRST202", message: "Could not find the function public.another_function" }), false);
});

test("GET do painel não consulta lista pessoal de entregadores para titular pendente ou inativo", async () => {
  for (const [status, active, expectedDrivers] of [["pending", false, 0], ["approved", false, 0], ["approved", true, 1]] as const) {
    const fixture = authFixture(status, active);
    const tables: string[] = [];
    const store = { id: storeId, slug: "loja-a", name: "Loja A", status, active };
    const supabase = {
      from(table: string) {
        tables.push(table);
        const rows = table === "market_stores" ? [store] : table === "market_store_members" ? [{ store_id: storeId, user_id: userId, role: "owner" }]
          : table === "drivers" ? [{ profile_id: "driver-a", profiles: { full_name: "Entregador autorizado", blocked: false } }] : [];
        const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          then: (resolve: (data: { data: typeof rows; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
        };
        return query;
      },
      rpc: async () => ({ data: false, error: null }),
    };
    const auth = { ...fixture.auth, supabase };
    const context = createContext({ auth, requestedStoreId: storeId, central: false,
      managementId: z.string().uuid(), marketplaceOperationsEnabled: async () => true, requireManageStore: async () => "owner",
      loadManagementOrders: async () => ({ orders: [], cashSchemaReady: true }),
      managementError: (error: unknown) => { if (error) throw error; }, ApiError, STORE_FIELDS: "id,name,status,active",
    });
    runInContext(script("../lib/backend/marketplace-management.ts", "managementData"), context);
    const result = await runInContext("managementData(auth, requestedStoreId, central)", context);
    assert.equal(result.drivers.length, expectedDrivers);
    assert.equal(tables.includes("drivers"), expectedDrivers > 0);
    assert.equal(result.store.id, storeId);
  }
});
