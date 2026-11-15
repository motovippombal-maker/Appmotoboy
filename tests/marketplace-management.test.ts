import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { ApiError } from "../lib/backend/errors";
import { requireManageStore, requireManagementImageStore, requireManagementOrder } from "../lib/backend/marketplace-management-access";
import { adminManagementAction, isPublicMarketplaceImage, merchantManagementAction } from "../lib/marketplace/management";
import { MARKET_IMAGE_LIMIT, MarketImageTooLarge, marketImageSignatureValid, marketImageType, readMarketImageBody } from "../lib/marketplace/image-upload";
import { marketCashAmountInCents, marketOrderCashState, summarizeMarketCash, type MarketCashSnapshot } from "../lib/marketplace/cash-reconciliation";
import { marketCashReceiptInput } from "../lib/marketplace/cash-input";
import { marketId } from "../lib/marketplace/customer-contract";
import { isMarketCashActionUnavailable, isMarketCashColumnMissing, LEGACY_MARKET_CASH_FIELDS, legacyMarketCash, readWithMarketCashFallback } from "../lib/backend/marketplace-cash-schema";
import { MARKET_CASH_FIELDS } from "../lib/marketplace/cash-reconciliation";

const storeA = "00000000-0000-4000-8000-000000000001";
const storeB = "00000000-0000-4000-8000-000000000002";
const merchant = "00000000-0000-4000-8000-000000000003";
const product = "00000000-0000-4000-8000-000000000004";
const order = "00000000-0000-4000-8000-000000000005";
const status = (expected: number) => (error: unknown) => error instanceof ApiError && error.status === expected;

function scopeFixture(role: "owner" | "manager", blocked = false) {
  const tables = {
    market_store_members: [{ store_id: storeA, user_id: merchant, role }, { store_id: storeB, user_id: "outra-pessoa", role }],
    market_orders: [{ id: order, store_id: storeA }],
    market_stores: [{ id: storeA }, { id: storeB }],
  };
  const reads: { table: string; key: string; value: string }[] = [];
  const fake = {
    from(table: keyof typeof tables) {
      const filters = new Map<string, string>();
      const query = {
        select: () => query,
        eq(key: string, value: string) { filters.set(key, value); reads.push({ table, key, value }); return query; },
        async maybeSingle() {
          const data = tables[table].find((row) => [...filters].every(([key, value]) => (row as Record<string, string>)[key] === value)) ?? null;
          return { data, error: null };
        },
      };
      return query;
    },
  };
  const auth = { user: { id: merchant }, profile: { role: "passenger", blocked }, supabase: fake } as unknown as Parameters<typeof requireManageStore>[0];
  return { auth, reads };
}

test("vínculo de uma conta existente não permite acessar outra loja trocando storeId", async () => {
  const { auth, reads } = scopeFixture("owner");
  assert.equal(await requireManageStore(auth, storeA), "owner");
  await assert.rejects(requireManageStore(auth, storeB), status(403));
  assert.deepEqual(reads.slice(-2), [
    { table: "market_store_members", key: "store_id", value: storeB },
    { table: "market_store_members", key: "user_id", value: merchant },
  ]);
});

test("gerente pode editar catálogo, mas não pode alterar preferência; vínculo bloqueado falha fechado", async () => {
  const { auth } = scopeFixture("manager");
  assert.equal(await requireManageStore(auth, storeA), "manager");
  await assert.rejects(requireManageStore(auth, storeA, true), status(403));
  const blocked = scopeFixture("owner", true);
  await assert.rejects(requireManageStore(blocked.auth, storeA), status(403));
  assert.equal(blocked.reads.length, 0);
});

test("um pedido encontrado por UUID não autoriza ação quando veio de outra loja", async () => {
  const { auth, reads } = scopeFixture("owner");
  await requireManagementOrder(auth.supabase, storeA, order);
  await assert.rejects(requireManagementOrder(auth.supabase, storeB, order), status(404));
  assert.deepEqual(reads.slice(-2), [
    { table: "market_orders", key: "id", value: order },
    { table: "market_orders", key: "store_id", value: storeB },
  ]);
});

test("comerciante não pode aprovar a própria loja, conceder acesso ou confirmar recebimento", () => {
  for (const action of [
    { action: "setStoreStatus", storeId: storeA, status: "approved", reason: "Conferência feita" },
    { action: "setMember", storeId: storeA, userId: merchant, role: "owner", reason: "Conferência feita" },
    { action: "cashAction", storeId: storeA, orderId: order, command: "receive", amountCents: 1000, reason: "Recebido em espécie" },
  ]) {
    assert.equal(merchantManagementAction.safeParse(action).success, false);
    assert.equal(adminManagementAction.safeParse(action).success, true);
  }
  assert.equal(merchantManagementAction.safeParse({ action: "orderAction", storeId: storeA, orderId: order, command: "reject" }).success, false);
  assert.equal(merchantManagementAction.safeParse({ action: "orderAction", storeId: storeA, orderId: order, command: "reject", reason: "Não temos os itens" }).success, true);
});

test("edição de produto exige a revisão do estoque; filiais não podem ser passadas no payload interno", () => {
  const fields = { name: "Produto", active: true, sort_order: 0, category_id: null, description: "", image_url: null, price_cents: 550, stock_quantity: 3 };
  const edit = { action: "saveProduct", storeId: storeA, id: product };
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields }).success, false);
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields: { ...fields, expected_stock: null } }).success, true);
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields: { ...fields, expected_stock: null, store_id: storeB } }).success, false);
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields: { ...fields, expected_stock: 3, price_cents: 5.5 } }).success, false);
});

test("horários permitem virar a meia-noite e rejeitam sobreposição ao cruzar a semana", () => {
  const fields = { name: "Loja Teste", description: "", category: "Mercado", image_url: null, cover_url: null, is_open: true, prep_minutes: null };
  const edit = { action: "saveStore", storeId: storeA };
  const opensSunday = { "7": [{ open: "18:00", close: "02:30" }] };
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields: { ...fields, hours: opensSunday } }).success, true);
  assert.equal(merchantManagementAction.safeParse({ ...edit, fields: { ...fields, hours: { ...opensSunday, "1": [{ open: "02:00", close: "08:00" }] } } }).success, false);
});

test("imagens externas precisam de URL pública HTTPS sem segredo nem caminho escapado", () => {
  assert.equal(isPublicMarketplaceImage("https://cdn.exemploloja.com.br/produtos/foto.jpg"), true);
  for (const url of [
    "http://cdn.exemploloja.com.br/produtos/foto.jpg", "https://user@cdn.exemploloja.com.br/foto.jpg",
    "https://localhost/foto.jpg", "https://files.local/foto.jpg", "https://127.0.0.1/foto.jpg",
    "https://2130706433/foto.jpg", "https://[::1]/foto.jpg", "https://cdn.exemploloja.com.br:444/foto.jpg",
    "https://cdn.exemploloja.com.br/foto.jpg?token=value", "https://cdn.exemploloja.com.br/../foto.jpg",
    "https://cdn.exemploloja.com.br/%2Ffoto.jpg", "https://cdn.exemploloja.com.br/",
  ]) assert.equal(isPublicMarketplaceImage(url), false, url);
});

test("upload de imagem exige loja existente e vínculo ou administração", async () => {
  const { auth, reads } = scopeFixture("manager");
  await requireManagementImageStore(auth, storeA);
  await assert.rejects(requireManagementImageStore(auth, storeB), status(403));
  assert.equal(reads.some((row) => row.table === "market_stores" && row.value === storeB), false);
  const central = { ...auth, profile: { ...auth.profile, role: "admin" as const } };
  await requireManagementImageStore(central, storeB);
  await assert.rejects(requireManagementImageStore(central, product), status(404));
});

test("upload confere MIME e assinatura sem permitir que SVG/HTML se passem por imagem", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh9sAAAAASUVORK5CYII=", "base64");
  const jpg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 14, 74, 70, 73, 70, 0, 1, 1, 0, 0xff, 0xd9);
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0); webp.writeUInt32LE(22, 4);
  webp.write("WEBPVP8X", 8); webp.writeUInt32LE(10, 16);
  assert.equal(marketImageSignatureValid(png, "image/png"), true);
  assert.equal(marketImageSignatureValid(jpg, "image/jpeg"), true);
  assert.equal(marketImageSignatureValid(webp, "image/webp"), true);
  assert.equal(marketImageSignatureValid(png, "image/webp"), false);
  assert.equal(marketImageSignatureValid(png.subarray(0, png.length - 1), "image/png"), false);
  assert.equal(marketImageSignatureValid(webp.subarray(0, 29), "image/webp"), false);
  assert.equal(marketImageSignatureValid(new TextEncoder().encode("<svg><script>confirm(1)</script></svg>"), "image/jpeg"), false);
  assert.equal(marketImageType("image/svg+xml"), null);
  assert.equal(marketImageType("application/octet-stream"), null);
});

test("upload mantém limite de 3 MB mesmo sem Content-Length ou com tamanho declarado menor", async () => {
  const stream = (chunks: number[]) => new ReadableStream<Uint8Array>({ start(controller) {
    for (const size of chunks) controller.enqueue(new Uint8Array(size));
    controller.close();
  } });
  assert.equal((await readMarketImageBody(stream([1024, MARKET_IMAGE_LIMIT - 1024]), null)).length, MARKET_IMAGE_LIMIT);
  await assert.rejects(readMarketImageBody(stream([MARKET_IMAGE_LIMIT, 1]), "10"), MarketImageTooLarge);
  await assert.rejects(readMarketImageBody(stream([MARKET_IMAGE_LIMIT, 1]), null), MarketImageTooLarge);
  await assert.rejects(readMarketImageBody(null, String(MARKET_IMAGE_LIMIT + 1)), MarketImageTooLarge);
});

test("caixa exige centavos válidos e não permite cliente informar parcela ou autor", () => {
  assert.equal(marketCashAmountInCents("10,09"), 1009);
  assert.equal(marketCashAmountInCents("1.2"), 120);
  assert.equal(marketCashAmountInCents(" 0,00 "), 0);
  assert.equal(marketCashAmountInCents("2000000"), 200_000_000);
  for (const value of ["", "-1", "1,234", "1.000,00", "1e3", "2000000,01", "1,"]) assert.equal(marketCashAmountInCents(value), null);
  for (const payload of [{}, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: 200_000_001 }, { amountCents: "1000" }, { amountCents: 1000, storeDueCents: 999 },
    { amountCents: 1000, actorId: product }, { amountCents: 1000, reference: " " }]) assert.equal(marketCashReceiptInput.safeParse(payload).success, false);
  assert.ok(marketCashReceiptInput.safeParse({ amountCents: 0 }).success);
  const action = { action: "cashAction", storeId: storeA, orderId: order, command: "settle", reason: "Repasse conferido", amountCents: 8000 };
  for (const schema of [adminManagementAction, merchantManagementAction]) {
    assert.equal(schema.safeParse(action).success, false);
    assert.equal(schema.safeParse({ ...action, reference: "TESTE-001" }).success, true);
  }
});

const expectedCash: MarketCashSnapshot = { amount_cents: 10000, store_due_cents: 8000, driver_due_cents: 2000, platform_due_cents: 0,
  received_at: null, received_amount_cents: null, settled_at: null, settled_amount_cents: null };
const delivered = (cash: MarketCashSnapshot | null) => ({ status: "delivered", logistics_status: "delivered", total_cents: 10000, cash });
const now = "2026-11-15T12:00:00Z";

test("conciliação separa valor previsto, entregue, recebido, repasse e diferenças sem compensação entre pedidos", () => {
  const shorter = delivered({ ...expectedCash, received_at: now, received_amount_cents: 9000 });
  const over = delivered({ ...expectedCash, received_at: now, received_amount_cents: 12000 });
  const settled = delivered({ ...expectedCash, received_at: now, received_amount_cents: 10000, settled_at: now, settled_amount_cents: 8000 });
  const legacy = delivered({ ...expectedCash, received_at: now, settled_at: now });
  const inconsistent = { ...delivered(expectedCash), total_cents: 9500 };
  const cancelled = { ...delivered(expectedCash), status: "cancelled", logistics_status: "cancelled" };
  assert.equal(marketOrderCashState(shorter), "divergent");
  assert.equal(marketOrderCashState(legacy), "legacy_unverified");
  assert.equal(marketOrderCashState(cancelled), "not_due");
  assert.equal(marketOrderCashState(inconsistent), "inconsistent");
  const summary = summarizeMarketCash([delivered(expectedCash), shorter, over, settled, legacy, delivered(null), inconsistent, cancelled]);
  assert.deepEqual(summary, { completedOrders: 7, deliveredTotalCents: 69_500, receivedCents: 31_000, receivedWithAmount: 3, pendingCashCents: 10_000,
    expectedStoreCents: 40_000, expectedDriverCents: 10_000, expectedPlatformCents: 0, storeSettledCents: 8_000, settledWithAmount: 1,
    shortCents: 1_000, overCents: 2_000, divergentOrders: 2, legacyOrders: 1, inconsistentOrders: 2 });
});

test("valor zero registrado não vira recebimento ausente nem libera repasse", () => {
  const zero = delivered({ ...expectedCash, received_at: now, received_amount_cents: 0 });
  assert.equal(marketOrderCashState(zero), "divergent");
  const result = summarizeMarketCash([zero]);
  assert.equal(result.receivedWithAmount, 1);
  assert.equal(result.receivedCents, 0);
  assert.equal(result.pendingCashCents, 0);
  assert.equal(result.shortCents, expectedCash.amount_cents);
  assert.equal(result.storeSettledCents, 0);
});

function executableFunction(relative: string, name: string) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const statement = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(statement);
  return ts.transpileModule(statement.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

test("POST de recebimento com operações pausadas não consome limite nem registra caixa", async () => {
  const calls: string[] = [];
  const supabase = { rpc: (name: string) => { calls.push(name); } };
  const context = createContext({
    supabase, request: { json: () => assert.fail("não deve ler dados de caixa fora do ambiente isolado") }, params: Promise.resolve({ id: order }),
    requireUser: async (_request: unknown, roles: string[]) => { assert.equal(roles.join(","), "driver"); return { user: { id: merchant }, supabase }; },
    requireMarketplaceOperations: async () => { throw new ApiError(503, "Operações indisponíveis", "MARKETPLACE_OPERATIONS_PAUSED"); },
    consumeRateLimit: async () => { calls.push("rate-limit"); }, jsonError: (error: ApiError) => ({ status: error.status, code: error.code }),
  });
  runInContext(executableFunction("../app/api/marketplace/orders/[id]/payment/route.ts", "POST"), context);
  const response = await runInContext("POST(request, { params })", context);
  assert.equal(response.status, 503);
  assert.equal(response.code, "MARKETPLACE_OPERATIONS_PAUSED");
  assert.deepEqual(calls, []);
});

test("POST de recebimento após prova de ambiente repassa somente valor informado, referência e ator autenticado", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const supabase = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { receivedAmountCents: 9123 }, error: null }; } };
  const context = createContext({
    request: { json: async () => ({ amountCents: 9123, reference: "TESTE-CAIXA", note: "Valor sintético conferido" }) }, params: Promise.resolve({ id: order }),
    requireUser: async () => ({ supabase, user: { id: merchant } }), requireMarketplaceOperations: async () => { calls.push({ name: "gate" }); },
    consumeRateLimit: async () => { calls.push({ name: "rate-limit" }); }, marketId, marketCashReceiptInput,
    isMarketCashActionUnavailable, marketResponse: (value: unknown) => value, jsonError: (error: unknown) => { throw error; },
  });
  runInContext(executableFunction("../app/api/marketplace/orders/[id]/payment/route.ts", "POST"), context);
  const response = await runInContext("POST(request, { params })", context);
  assert.equal(response.receivedAmountCents, 9123);
  assert.deepEqual(calls.map(({ name }) => name), ["gate", "rate-limit", "market_record_cash_action"]);
  assert.deepEqual({ ...calls[2].args }, { p_actor_id: merchant, p_order_id: order, p_action: "receive", p_amount_cents: 9123,
    p_reference: "TESTE-CAIXA", p_note: "Valor sintético conferido" });
});

const oldCashColumnError = { code: "42703", message: "column market_cash_payments.received_amount_cents does not exist" };

test("fallback caixa reconhece apenas os campos novos da 1450 e não ignora falha de acesso", async () => {
  assert.equal(isMarketCashColumnMissing(oldCashColumnError), true);
  assert.equal(isMarketCashColumnMissing({ code: "42703", message: 'column "public"."market_cash_payments_2"."settlement_reference" does not exist' }), true);
  assert.equal(isMarketCashColumnMissing({ code: "PGRST204", message: "Could not find the 'receipt_reference' column of 'market_cash_payments' in the schema cache" }), true);
  for (const error of [
    { code: "42703", message: "column rides.received_amount_cents does not exist" },
    { code: "42703", message: "column market_cash_payments.received_at does not exist" },
    { code: "42501", message: "permission denied for table market_cash_payments" },
    { code: "42P01", message: "relation market_cash_payments does not exist" },
    { code: "PGRST204", message: "Could not find the 'receipt_reference' column of 'rides' in the schema cache" },
  ]) {
    const result = await readWithMarketCashFallback(async () => ({ error }), async () => assert.fail("não deve repetir leitura"));
    assert.equal(result.schemaReady, true);
    assert.equal(result.result.error, error);
  }
});

test("GET de caixa do motorista antes da 1450 preserva escopo e histórico; após a 1450 preserva o valor registrado", async () => {
  for (const current of [false, true]) {
    const paymentCalls: { fields: string; orderId?: string }[] = [];
    const currentReceipt = { ...expectedCash, received_at: now, received_amount_cents: 0 };
    const { received_amount_cents: _received, settled_amount_cents: _settlement, ...oldReceipt } = currentReceipt;
    assert.equal(_received, 0);
    assert.equal(_settlement, null);
    const supabase = {
      from(table: string) {
        if (table === "market_orders") {
          const filters = new Map<string, string>();
          const query = { select: () => query, eq: (column: string, value: string) => { filters.set(column, value); return query; }, in: () => query,
            maybeSingle: async () => { assert.equal(filters.get("id"), order); assert.equal(filters.get("assigned_driver_id"), merchant); return { data: { id: order }, error: null }; } };
          return query;
        }
        assert.equal(table, "market_cash_payments");
        return { select: (fields: string) => {
          const call: { fields: string; orderId?: string } = { fields };
          paymentCalls.push(call);
          return { eq: (column: string, id: string) => {
            assert.equal(column, "order_id"); call.orderId = id;
            return { single: async () => fields === MARKET_CASH_FIELDS
              ? current ? { data: currentReceipt, error: null } : { data: null, error: oldCashColumnError }
              : { data: oldReceipt, error: null } };
          } };
        } };
      },
    };
    const context = createContext({ request: {}, params: Promise.resolve({ id: order }), ApiError, marketId, MARKET_CASH_FIELDS, LEGACY_MARKET_CASH_FIELDS,
      legacyMarketCash, readWithMarketCashFallback, marketplaceOperationsEnabled: async () => true,
      requireUser: async () => ({ supabase, user: { id: merchant } }), marketResponse: (value: unknown) => value,
      jsonError: (error: unknown) => { throw error; }, throwMarketError: (error: unknown) => { throw error; },
    });
    runInContext(executableFunction("../app/api/marketplace/orders/[id]/payment/route.ts", "GET"), context);
    const result = await runInContext("GET(request, { params })", context);
    assert.equal(result.cashWritesEnabled, current);
    assert.equal(result.cashSchemaReady, current);
    assert.equal(result.payment.received_at, now);
    assert.equal(result.payment.received_amount_cents, current ? 0 : null);
    assert.deepEqual(paymentCalls, current ? [{ fields: MARKET_CASH_FIELDS, orderId: order }] : [{ fields: MARKET_CASH_FIELDS, orderId: order }, { fields: LEGACY_MARKET_CASH_FIELDS, orderId: order }]);
  }
});

test("RPC de caixa indisponível menciona atualização e nunca escreve pela RPC antiga", async () => {
  for (const error of [{ code: "42501", message: "permission denied for function market_record_cash_action" },
    { code: "PGRST202", message: "Could not find the function public.market_record_cash_action(p_action, p_actor_id) in the schema cache" }]) {
    const calls: string[] = [];
    const context = createContext({ request: { json: async () => ({ amountCents: 1000 }) }, params: Promise.resolve({ id: order }), ApiError, marketId, marketCashReceiptInput, isMarketCashActionUnavailable,
      requireUser: async () => ({ user: { id: merchant }, supabase: { rpc: async (name: string) => { calls.push(name); return { data: null, error }; } } }),
      requireMarketplaceOperations: async () => {}, consumeRateLimit: async () => {}, jsonError: (problem: ApiError) => ({ status: problem.status, code: problem.code }),
    });
    runInContext(executableFunction("../app/api/marketplace/orders/[id]/payment/route.ts", "POST"), context);
    const result = await runInContext("POST(request, { params })", context);
    assert.equal(result.status, 503);
    assert.equal(result.code, "MARKET_CASH_UPDATE_PENDING");
    assert.deepEqual(calls, ["market_record_cash_action"]);
  }
});
