import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { ZodError } from "zod";
import ts from "typescript";
import { ApiError } from "../lib/backend/errors";
import { storeOnboardingInput, storeOnboardingResult, throwStoreOnboardingError } from "../lib/marketplace/store-onboarding";

const actorId = "00000000-0000-4000-8000-000000000001";
const storeId = "00000000-0000-4000-8000-000000000002";
const idempotencyKey = "00000000-0000-4000-8000-000000000003";
const valid = {
  idempotencyKey, slug: "loja-exemplo", name: " Loja de Exemplo ", category: "Comida",
  pickup: { address: "Rua Sintética, 10", latitude: -10.8373, longitude: -38.5357 },
};
const pending = { storeId, slug: "loja-exemplo", status: "pending", active: false, reused: false };
const source = readFileSync(new URL("../app/api/marketplace/merchant/onboarding/route.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const post = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
assert.ok(post);
const executable = ts.transpileModule(post.getText(parsed).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture({ authenticated = true, enabled = true, data = pending, error = null }: {
  authenticated?: boolean; enabled?: boolean; data?: unknown;
  error?: { code?: string; message?: string } | null;
} = {}) {
  const calls: string[] = [];
  const argumentsSent: Record<string, unknown>[] = [];
  const supabase = { rpc: async (name: string, params: Record<string, unknown>) => {
    calls.push(name); argumentsSent.push(params); return { data, error };
  } };
  const context = createContext({
    ApiError, Response, storeOnboardingInput, storeOnboardingResult, throwStoreOnboardingError,
    requireUser: async () => {
      if (!authenticated) throw new ApiError(401, "Entre na conta.", "AUTH_REQUIRED");
      return { user: { id: actorId }, supabase };
    },
    requireMarketplaceOperations: async () => {
      calls.push("operations");
      if (!enabled) throw new ApiError(503, "Compras pausadas.", "MARKETPLACE_OPERATIONS_PAUSED");
    },
    consumeRateLimit: async () => { calls.push("rate-limit"); },
    jsonError: (problem: unknown) => problem instanceof ApiError
      ? Response.json({ code: problem.code }, { status: problem.status })
      : problem instanceof ZodError ? Response.json({ code: "INVALID_INPUT" }, { status: 400 })
        : Response.json({ code: "UNEXPECTED_ERROR" }, { status: 500 }),
  });
  runInContext(executable, context);
  return {
    calls, argumentsSent,
    post: async (input: unknown = valid) => {
      context.request = { json: async () => input };
      const response = await runInContext("POST(request)", context) as Response;
      return { status: response.status, body: await response.json(), cache: response.headers.get("Cache-Control") };
    },
  };
}

test("cadastro exige localização real informada e recusa campos de autoridade", () => {
  assert.equal(storeOnboardingInput.parse(valid).name, "Loja de Exemplo");
  assert.equal(storeOnboardingInput.parse(valid).description, "");
  for (const extra of [{ actorId }, { storeId }, { status: "approved" }, { active: true }, { role: "admin" }, { is_open: true }])
    assert.equal(storeOnboardingInput.safeParse({ ...valid, ...extra }).success, false);
  for (const pickup of [undefined, { ...valid.pickup, address: "" }, { ...valid.pickup, latitude: 91 },
    { ...valid.pickup, longitude: Number.NaN }, { ...valid.pickup, service_area_id: storeId }])
    assert.equal(storeOnboardingInput.safeParse({ ...valid, pickup }).success, false);
});

test("POST usa ator autenticado, dados normalizados e mesma chave na RPC atômica", async () => {
  const f = fixture();
  const result = await f.post();
  assert.equal(result.status, 201);
  assert.equal(result.cache, "private, no-store");
  assert.deepEqual(result.body, pending);
  assert.deepEqual(f.calls, ["operations", "rate-limit", "market_register_store"]);
  assert.equal(f.argumentsSent[0].p_actor_id, actorId);
  assert.equal(f.argumentsSent[0].p_idempotency_key, idempotencyKey);
  const data = f.argumentsSent[0].p_data as { name: string; description: string };
  assert.equal(data.name, "Loja de Exemplo");
  assert.equal(data.description, "");
});

test("pausa global, ausência de sessão e tentativa de autoaprovação não chamam cadastro", async () => {
  const paused = fixture({ enabled: false });
  assert.deepEqual((await paused.post()).body, { code: "MARKETPLACE_OPERATIONS_PAUSED" });
  assert.deepEqual(paused.calls, ["operations"]);
  const anonymous = fixture({ authenticated: false });
  assert.equal((await anonymous.post()).status, 401);
  assert.deepEqual(anonymous.calls, []);
  const malicious = fixture();
  assert.equal((await malicious.post({ ...valid, role: "owner", active: true })).status, 400);
  assert.equal(malicious.argumentsSent.length, 0);
});

test("replay propaga estado atual e jamais responde pending depois da aprovação", async () => {
  const current = { ...pending, status: "approved", active: true, reused: true };
  const result = await fixture({ data: current }).post();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, current);
});

test("RPC comunica chave conflitante, slug ocupado, vínculo revogado e migração ausente sem vazar SQL", async () => {
  for (const [error, status, code] of [
    [{ message: "MARKET_REGISTRATION_CONFLICT" }, 409, "MARKET_REGISTRATION_CONFLICT"],
    [{ code: "23505", message: "private constraint details" }, 409, "MARKET_SLUG_UNAVAILABLE"],
    [{ code: "42501", message: "MARKET_FORBIDDEN" }, 403, "MARKET_FORBIDDEN"],
    [{ code: "PGRST202", message: "function not found" }, 503, "MARKET_ONBOARDING_NOT_CONFIGURED"],
  ] as const) {
    const result = await fixture({ error }).post();
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { code });
  }
});

test("resposta incompleta não é apresentada como loja criada", async () => {
  const result = await fixture({ data: { storeId } }).post();
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { code: "MARKET_REGISTRATION_UNAVAILABLE" });
});
