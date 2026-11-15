import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { ApiError } from "../lib/backend/errors";
import { marketCheckoutInput, marketQuoteInput } from "../lib/marketplace/customer-contract";
import { checkoutFingerprint, readMarketQuote, signMarketQuote } from "../lib/marketplace/quote-signature";
import { createMarketCheckoutAttempts, isPurchasedCart, nextMarketAccountScope } from "../lib/marketplace/checkout-attempt";
import { marketSnapshotAfterError } from "../lib/marketplace/query-state";
import type { MarketCart } from "../lib/marketplace/cart";

const storeId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const optionA = "00000000-0000-4000-8000-000000000003";
const optionB = "00000000-0000-4000-8000-000000000004";
const customerId = "00000000-0000-4000-8000-000000000005";
const key = "00000000-0000-4000-8000-000000000006";
const orderId = "00000000-0000-4000-8000-000000000007";
const secret = "local-test-fixture-key-no-production-credentials";
const input = marketQuoteInput.parse({
  storeId,
  cart: [{ productId, quantity: 2, optionIds: [optionA, optionB] }],
  delivery: { address: "Rua da Praça, 20", lat: -10.83, lng: -38.5, recipientName: "Ana Silva", recipientPhone: "(75) 99999-1234" },
});
const claims = {
  version: 1 as const, customerId,
  requestFingerprint: checkoutFingerprint(input),
  catalogFingerprint: "c".repeat(64), fareFingerprint: "f".repeat(64),
  expiresAt: Math.floor(Date.now() / 1000) + 2 * 60,
};
const signed = signMarketQuote(claims, secret);

test("checkout admite apenas dinheiro, normaliza contato e rejeita campos de preço ou opções repetidas", () => {
  const valid = { ...input, paymentMethod: "cash", quoteToken: signed, idempotencyKey: key };
  assert.equal(marketCheckoutInput.parse(valid).delivery.recipientPhone, "+5575999991234");
  for (const paymentMethod of ["pix", "card"]) assert.equal(marketCheckoutInput.safeParse({ ...valid, paymentMethod }).success, false);
  assert.equal(marketCheckoutInput.safeParse({ ...valid, totalCents: 1 }).success, false);
  assert.equal(marketCheckoutInput.safeParse({ ...valid, discountCents: 1 }).success, false);
  const line = input.cart[0];
  for (const cart of [
    [{ ...line, priceCents: 1 }], [{ ...line, quantity: 0 }], [{ ...line, quantity: 1.5 }],
    [{ ...line, optionIds: [optionA, optionA] }],
  ]) assert.equal(marketCheckoutInput.safeParse({ ...valid, cart }).success, false);
});

test("cotação é protegida contra modificação; impressão vincula loja, endereço, quantidade, opções e destinatário", () => {
  assert.deepEqual(readMarketQuote(signed, secret), claims);
  assert.equal(readMarketQuote(signed, "other-secret"), null);
  const [payload, signature] = signed.split(".");
  const modifiedPayload = Buffer.from(JSON.stringify({ ...claims, fareFingerprint: "a".repeat(64) })).toString("base64url");
  assert.equal(readMarketQuote(`${modifiedPayload}.${signature}`, secret), null);
  assert.equal(readMarketQuote(`${payload}.${signature}.extra`, secret), null);
  const line = input.cart[0];
  const sameOptions = { ...input, cart: [{ ...line, optionIds: [...line.optionIds].reverse() }] };
  assert.equal(checkoutFingerprint(sameOptions), claims.requestFingerprint);
  for (const mutation of [
    { ...input, storeId: productId },
    { ...input, cart: [{ ...line, quantity: 3 }] },
    { ...input, cart: [{ ...line, optionIds: [optionB] }] },
    { ...input, delivery: { ...input.delivery, lat: -10.84 } },
    { ...input, delivery: { ...input.delivery, recipientPhone: "+5575999991235" } },
    { ...input, delivery: { ...input.delivery, notes: "Portão azul" } },
  ]) assert.notEqual(checkoutFingerprint(mutation), claims.requestFingerprint);
});

const routeSource = readFileSync(new URL("../app/api/marketplace/orders/route.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("route.ts", routeSource, ts.ScriptTarget.Latest, true);
const post = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
assert.ok(post);
// Execute the real handler without importing the server-only client or contacting Supabase.
const executable = ts.transpileModule(post.getText(parsed).replace(/^export\s+/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const currentQuote = { totalCents: 3900, subtotalCents: 3000, freightCents: 900 };

function checkoutFixture(options: {
  existing?: { id: string; request_fingerprint: string };
  changedCatalog?: boolean;
  changedFare?: boolean;
  testMode?: boolean;
} = {}) {
  const calls: string[] = [];
  const filters: Record<string, unknown> = {};
  const rpcArguments: Record<string, unknown>[] = [];
  const query = {
    eq(column: string, value: unknown) { filters[column] = value; return query; },
    async maybeSingle() { return { data: options.existing ?? null, error: null }; },
  };
  const db = {
    from(table: string) {
      assert.equal(table, "market_orders");
      return { select: () => query };
    },
    async rpc(rpc: string, args: Record<string, unknown>) {
      calls.push(rpc);
      rpcArguments.push(args);
      return { data: { orderId, reused: false }, error: null };
    },
  };
  const context = createContext({
    ApiError, marketCheckoutInput, checkoutFingerprint, readMarketQuote,
    marketQuoteSecret: () => secret,
    requireUser: async () => ({ supabase: db, user: { id: customerId } }),
    requireMarketplaceOperations: async () => {
      if (options.testMode === false) throw new ApiError(503, "Bloqueado", "MARKETPLACE_OPERATIONS_PAUSED");
    },
    consumeRateLimit: async () => {},
    marketResponse: (data: unknown, status = 200) => ({ data, status }),
    jsonError: (error: unknown) => {
      assert.ok(error instanceof ApiError);
      return { code: error.code, status: error.status, data: error.details };
    },
    throwMarketError: ({ message }: { message: string }) => { throw new ApiError(409, message, message); },
    prepareMarketQuote: async () => {
      calls.push("prepareMarketQuote");
      return { claims: {
        ...claims,
        catalogFingerprint: options.changedCatalog ? "d".repeat(64) : claims.catalogFingerprint,
        fareFingerprint: options.changedFare ? "b".repeat(64) : claims.fareFingerprint,
      }, pickup: { address: "Rua da Loja, 1", lat: -10.82, lng: -38.51 },
      fare: { freightCents: 900, discountCents: 0 }, quote: currentQuote };
    },
  });
  runInContext(executable, context);
  return {
    calls, filters, rpcArguments,
    checkout: async (quoteToken = signed) => {
      context.request = { json: async () => ({ ...input, paymentMethod: "cash", idempotencyKey: key, quoteToken }) };
      return await runInContext("POST(request)", context) as { status: number; code?: string; data?: unknown };
    },
  };
}

test("checkout inativo não calcula nem cria pedido, mas permite reconciliar um registro já existente", async () => {
  const denied = checkoutFixture({ testMode: false });
  const deniedResult = await denied.checkout();
  assert.equal(deniedResult.status, 503);
  assert.equal(deniedResult.code, "MARKETPLACE_OPERATIONS_PAUSED");
  assert.deepEqual(denied.calls, []);
  const recovery = checkoutFixture({ testMode: false, existing: { id: orderId, request_fingerprint: claims.requestFingerprint } });
  assert.equal((await recovery.checkout()).status, 200);
  assert.deepEqual(recovery.calls, []);
});

test("resposta perdida recupera a compra anterior sem repetir cotação nem reserva", async () => {
  const fixture = checkoutFixture({ existing: { id: orderId, request_fingerprint: claims.requestFingerprint } });
  const result = await fixture.checkout(signMarketQuote({ ...claims, expiresAt: 1 }, secret));
  assert.equal(result.status, 200);
  assert.equal((result.data as { orderId: string }).orderId, orderId);
  assert.equal((result.data as { reused: boolean }).reused, true);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.filters.customer_id, customerId);
  assert.equal(fixture.filters.idempotency_key, key);
});

test("mesma chave com carga diferente e cotação de outra conta não disparam checkout", async () => {
  const retry = checkoutFixture({ existing: { id: orderId, request_fingerprint: "d".repeat(64) } });
  const reused = await retry.checkout();
  assert.equal(reused.status, 409);
  assert.equal(reused.code, "MARKET_IDEMPOTENCY_CONFLICT");
  assert.deepEqual(retry.calls, []);
  const other = checkoutFixture();
  const forbidden = await other.checkout(signMarketQuote({ ...claims, customerId: productId }, secret));
  assert.equal(forbidden.status, 409);
  assert.equal(forbidden.code, "MARKET_INVALID_QUOTE");
  assert.deepEqual(other.calls, []);
});

test("checkout pede reconfirmação para cotação expirada, catálogo ou frete alterado", async () => {
  for (const options of [{ changedCatalog: true }, { changedFare: true }, {}]) {
    const fixture = checkoutFixture(options);
    const token = "changedCatalog" in options || "changedFare" in options ? signed : signMarketQuote({ ...claims, expiresAt: 1 }, secret);
    const result = await fixture.checkout(token);
    assert.equal(result.status, 409);
    assert.equal(result.code, "MARKET_QUOTE_CHANGED");
    assert.equal((result.data as { quote: unknown }).quote, currentQuote);
    assert.deepEqual(fixture.calls, ["prepareMarketQuote"]);
  }
});

test("carrinho confirmado passa ponto da loja, catálogo e regras do servidor à RPC transacional", async () => {
  const fixture = checkoutFixture();
  const result = await fixture.checkout();
  assert.equal(result.status, 201);
  assert.deepEqual(fixture.calls, ["prepareMarketQuote", "market_checkout"]);
  const args = fixture.rpcArguments[0];
  assert.equal(args.p_customer_id, customerId);
  assert.equal(args.p_store_id, storeId);
  assert.equal(args.p_idempotency_key, key);
  assert.equal(args.p_request_fingerprint, claims.requestFingerprint);
  assert.equal(args.p_catalog_fingerprint, claims.catalogFingerprint);
  assert.equal((args.p_pickup as { address: string }).address, "Rua da Loja, 1");
  assert.equal((args.p_fare as { freightCents: number }).freightCents, 900);
});

function findNode<T extends ts.Node>(node: ts.Node, predicate: (candidate: ts.Node) => candidate is T): T | undefined {
  return predicate(node) ? node : ts.forEachChild(node, (child) => findNode(child, predicate));
}

function uiSource(relative: string) {
  const content = readFileSync(new URL(relative, import.meta.url), "utf8");
  return ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true, relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function uiAction(context: ReturnType<typeof createContext>, parsed: ts.SourceFile, name: string) {
  const node = findNode(parsed, (candidate): candidate is ts.FunctionDeclaration => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
  assert.ok(node);
  runInContext(ts.transpileModule(node.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
}

const cart: MarketCart = { storeId, slug: "padaria-a", entries: input.cart.map((line) => ({ ...line, title: "Pão", optionsLabel: "", estimatedUnitCents: 500 })) };
const tab = () => {
  const db = new Map<string, string>();
  return { db, getItem: (id: string) => db.get(id) ?? null, setItem: (id: string, value: string) => { db.set(id, value); }, removeItem: (id: string) => { db.delete(id); } };
};

test("resposta perdida e recuperação em Meus pedidos retiram a compra do carrinho sem outro POST", async () => {
  const ledger = createMarketCheckoutAttempts();
  const storage = tab();
  const attemptStorageKey = `moto-pombal:market-checkout:${customerId}`;
  ledger.remember(customerId, key, cart, storage);
  assert.deepEqual([...storage.db.values()], [key]);
  let currentCart: MarketCart | null = { ...cart, entries: [...cart.entries] };
  let found: string | null = null;
  const requests: string[] = [];
  const sandbox = createContext({
    userId: customerId, pending: { current: false }, window: { sessionStorage: storage },
    isCurrentSession: () => true, pendingCheckoutKey: () => ledger.read(customerId, storage),
    resolveCheckout: (attempt: string) => {
      const result = ledger.resolve(customerId, attempt, storage);
      if (!result) return false;
      if (isPurchasedCart(currentCart, result.cart)) currentCart = null;
      return true;
    },
    marketFetch: async (url: string, options: { method?: string; userId: string }) => {
      requests.push(`${options.method ?? "GET"} ${url}`);
      assert.equal(options.userId, customerId);
      return { order: { id: orderId } };
    },
    setBusy: () => {}, setMessage: () => {}, setFound: (id: string) => { found = id; }, marketMessage: String,
  });
  uiAction(sandbox, uiSource("../components/marketplace/customer-orders.tsx"), "lookup");
  await runInContext("lookup()", sandbox);
  assert.equal(found, orderId);
  assert.equal(storage.getItem(attemptStorageKey), null);
  assert.equal(currentCart, null);
  assert.deepEqual(requests, [`GET /api/marketplace/orders?checkout=${key}`]);
  const changedCart = { ...cart, entries: cart.entries.map((item) => ({ ...item, quantity: item.quantity + 1 })) };
  assert.equal(isPurchasedCart(changedCart, cart), false);
});

test("retomar chave pendente bloqueia POST até consultar; tentativa usa a mesma chave mesmo sem pedido encontrado", async () => {
  let pendingKey: string | null = key;
  let status = "";
  const requests: { url: string; key?: string }[] = [];
  const sandbox = createContext({
    userId: customerId, enabled: true, cart, inFlight: { current: false }, active: { current: true }, checkedKey: { current: null },
    checkoutKey: { current: key }, getKey: () => pendingKey, storageKey: `moto-pombal:market-checkout:${customerId}`,
    navigator: { onLine: true }, window: { crypto: { randomUUID: () => assert.fail("não deve criar nova tentativa") }, sessionStorage: tab() },
    AbortSignal, input, quote: { quoteToken: signed }, isCurrentSession: () => true, pendingCheckoutKey: () => pendingKey,
    setUncertain: () => {}, setBusy: () => {}, setMessage: (value: string) => { status = value; },
    rememberCheckout: (attempt: string) => { pendingKey = attempt; return true; }, completed: () => {},
    marketFetch: async (url: string, args?: { body?: { idempotencyKey?: string } }) => {
      requests.push({ url, key: args?.body?.idempotencyKey });
      return args?.body ? { orderId } : { order: null };
    }, marketMessage: String,
  });
  const parsed = uiSource("../components/marketplace/customer-store.tsx");
  uiAction(sandbox, parsed, "placeOrder");
  uiAction(sandbox, parsed, "checkExisting");
  await runInContext("placeOrder(input, quote)", sandbox);
  assert.deepEqual(requests, []);
  assert.match(status, /Consulte a tentativa anterior/);
  await runInContext("checkExisting()", sandbox);
  await runInContext("placeOrder(input, quote)", sandbox);
  assert.deepEqual(requests, [{ url: `/api/marketplace/orders?checkout=${key}`, key: undefined }, { url: "/api/marketplace/orders", key }]);
});

test("checkout concluído após troca de identidade não limpa compra nem navega na nova sessão", () => {
  const atStart = { id: customerId, generation: 1 };
  const switched = nextMarketAccountScope(atStart, productId);
  const back = nextMarketAccountScope(switched, customerId);
  assert.equal(back.id, atStart.id);
  assert.notEqual(back.generation, atStart.generation);
  let effects = 0;
  const sandbox = createContext({ orderId, key, cart, active: { current: true }, isCurrentSession: () => back.generation === atStart.generation,
    resolveCheckout: () => { effects++; return true; }, setUncertain: () => {}, setCart: () => { effects++; },
    window: { sessionStorage: tab() }, checkoutKey: { current: key }, storageKey: "test-checkout",
    router: { push: () => { effects++; } },
  });
  uiAction(sandbox, uiSource("../components/marketplace/customer-store.tsx"), "completed");
  runInContext("completed(orderId, key, cart)", sandbox);
  assert.equal(effects, 0);
});

test("snapshot privado some após negar acesso, mas falha transitória não apaga uma sessão autorizada", () => {
  const current = { key: "conta-a:/api/marketplace/orders", data: { orders: [orderId] } };
  for (const status of [401, 403, 404, 410]) assert.equal(marketSnapshotAfterError(current, current.key, status), null);
  assert.equal(marketSnapshotAfterError(current, "conta-b:/api/marketplace/orders"), null);
  assert.equal(marketSnapshotAfterError(current, current.key, 503), current.data);
});

test("painel não envia dados antigos como outra conta e descarta uma resposta após logout", async () => {
  const parsed = uiSource("../components/marketplace/management-client.ts");
  const decl = findNode(parsed, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "request");
  assert.ok(decl?.initializer && ts.isCallExpression(decl.initializer));
  const callback = decl.initializer.arguments[0];
  const old = { id: customerId, generation: 1 };
  const fresh = nextMarketAccountScope(old, productId);
  let authId: string | null = fresh.id;
  let authorizeFetch: ((value: Response) => void) | undefined;
  let calls = 0;
  const authScope = { current: fresh };
  const sandbox = createContext({ old, fresh, authScope, navigator: { onLine: true }, File, AbortSignal,
    getSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: authId ? { user: { id: authId }, access_token: "fixture" } : null } }) } }),
    nextMarketAccountScope, signInRequired: () => new Error("sessão mudou"),
    fetch: () => { calls++; return new Promise<Response>((resolve) => { authorizeFetch = resolve; }); },
  });
  runInContext(ts.transpileModule(`const request = ${callback.getText(parsed)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, sandbox);
  await assert.rejects(runInContext('request("/api/admin/marketplace", { action: "findMember" }, old)', sandbox), /sessão mudou/);
  assert.equal(calls, 0);
  const read = runInContext('request("/api/admin/marketplace")', sandbox);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  authId = null;
  authScope.current = nextMarketAccountScope(fresh, authId);
  authorizeFetch!(Response.json({ sensitive: "old-session" }));
  await assert.rejects(read, /sessão mudou/);
});
