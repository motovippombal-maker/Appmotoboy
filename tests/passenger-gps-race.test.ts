import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInContext } from "node:vm";
import ts from "typescript";
import { bookingActionContext } from "./helpers/passenger-booking-actions";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actionSource(name: string, node: ts.Node = parsed): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(parsed);
  return ts.forEachChild(node, (child) => actionSource(name, child));
}
function automaticLocationEffect(node: ts.Node = parsed): string | undefined {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
    node.arguments[0]?.getText(parsed).includes("navigator.permissions.query")) return node.arguments[0].getText(parsed);
  return ts.forEachChild(node, (child) => automaticLocationEffect(child));
}
const requestSource = actionSource("requestCurrentLocation");
const centerSource = actionSource("centerOnCurrentLocation");
const automaticSource = automaticLocationEffect();
assert.ok(requestSource && centerSource && automaticSource);
const compiled = ts.transpileModule(`${requestSource}\n${centerSource}\nconst startAutomaticLocation = ${automaticSource};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type Point = { address: string; lat: number; lng: number; provider?: string };
const originA: Point = { address: "Origem A", lat: -10.8, lng: -38.5 };
const originB: Point = { address: "Origem B confirmada no mapa", lat: -10.81, lng: -38.51 };
const gpsPoint: Point = { address: "Endereço do GPS anterior", lat: -10.82, lng: -38.52 };
const destination: Point = { address: "Destino", lat: -10.83, lng: -38.53 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((done) => setImmediate(done));

function fixture(serviceType = "passenger", withDestination = false) {
  const pending: Array<ReturnType<typeof deferred<Point>>> = [];
  const permission = deferred<{ state: "granted" }>();
  const values: Record<string, unknown> = {
    originPoint: originA, originAddress: originA.address, destinationPoint: withDestination ? destination : null,
    destinationAddress: withDestination ? destination.address : "", selectedQuickPlace: null,
    serviceTypeRef: { current: serviceType }, isDelivery: serviceType !== "passenger",
    mapPicker: "origin", quoteRequestRef: { current: 0 }, gpsRequestRef: { current: 0 },
    busy: false, gpsBusy: false, estimate: null, notice: "", locationStatus: "",
    navigator: { permissions: { query: () => permission.promise } },
    locateDevice: () => { const request = deferred<Point>(); pending.push(request); return request.promise; },
    backend: {
      estimateRide: async (input: { origin: Point; destination: Point }) => input,
      findNearbyDrivers: async () => ({ drivers: [], arrivalSeconds: null }),
    },
  };
  let state = values;
  for (const name of ["Busy", "GpsBusy", "Estimate", "OriginPoint", "OriginAddress", "DestinationPoint", "DestinationAddress", "NearbyDrivers", "NearbyArrivalSeconds", "DestinationSearchOpen", "SheetMode", "Notice", "LocationStatus", "MapPicker"])
    values[`set${name}`] = (value: unknown) => { state[name[0].toLowerCase() + name.slice(1)] = value; };
  const booking = bookingActionContext(values);
  state = booking.values;
  runInContext(compiled, booking.values);
  return {
    state, pending, permission, confirmOrigin: (point: Point) => booking.confirmMapAddress(point),
    requestGps: () => runInContext("requestCurrentLocation()", booking.values) as Promise<void>,
    centerGps: () => runInContext("centerOnCurrentLocation()", booking.values) as Promise<void>,
    startAutomatic: () => runInContext("startAutomaticLocation()", booking.values),
  };
}

test("GPS e geocodificação anteriores não substituem origem confirmada no mapa no mesmo serviço", async () => {
  for (const service of ["passenger", "food"]) {
    const f = fixture(service);
    const request = f.requestGps();
    f.confirmOrigin(originB);
    f.pending[0].resolve(gpsPoint);
    await request;
    assert.equal(f.state.originAddress, originB.address);
    assert.equal(f.state.originPoint, originB);
    assert.equal(f.state.gpsBusy, false);
  }
});

test("falha atrasada do GPS não apaga mensagem e origem de uma seleção manual mais recente", async () => {
  const f = fixture();
  const request = f.requestGps();
  f.confirmOrigin(originB);
  f.state.notice = "Origem escolhida manualmente";
  f.pending[0].reject(new Error("GPS anterior falhou"));
  await request;
  assert.equal(f.state.originAddress, originB.address);
  assert.equal(f.state.notice, "Origem escolhida manualmente");
  assert.equal(f.state.gpsBusy, false);
});

test("resposta antiga não define origem nem encerra loading de uma solicitação GPS mais recente", async () => {
  const f = fixture();
  const first = f.requestGps();
  const latest = f.requestGps();
  f.pending[0].resolve(gpsPoint);
  await first;
  assert.equal(f.state.originPoint, originA);
  assert.equal(f.state.gpsBusy, true);
  f.pending[1].resolve(originB);
  await latest;
  assert.equal(f.state.originPoint, originB);
  assert.equal(f.state.gpsBusy, false);
});

test("erro de GPS antigo não muda aviso nem loading do pedido GPS mais recente", async () => {
  const f = fixture();
  const first = f.requestGps();
  const latest = f.requestGps();
  f.pending[0].reject(new Error("GPS antigo indisponível"));
  await first;
  assert.equal(f.state.notice, "");
  assert.equal(f.state.gpsBusy, true);
  f.pending[1].resolve(originB);
  await latest;
  assert.equal(f.state.gpsBusy, false);
});

test("GPS atual continua recalculando a cotação com destino existente para passageiro e entrega", async () => {
  for (const service of ["passenger", "delivery"]) {
    const f = fixture(service, true);
    const request = f.requestGps();
    f.pending[0].resolve(originB);
    await request;
    await flush();
    const quote = f.state.estimate as { origin: Point; destination: Point };
    assert.equal(quote.origin.address, originB.address);
    assert.equal(quote.destination.address, destination.address);
    assert.equal(f.state.gpsBusy, false);
    assert.equal(f.state.busy, false);
  }
});

test("centralizar mapa e selecionar origem compartilham loading sem respostas antigas encerrando GPS novo", async () => {
  const f = fixture();
  const previous = f.requestGps();
  const center = f.centerGps();
  f.pending[0].resolve(gpsPoint);
  await previous;
  assert.equal(f.state.originPoint, originA);
  assert.equal(f.state.gpsBusy, true);
  f.pending[1].resolve(originB);
  await center;
  assert.equal(f.state.originPoint, originA);
  assert.equal(f.state.gpsBusy, false);
  const previousCenter = f.centerGps();
  const latest = f.requestGps();
  f.pending[2].reject(new Error("Centralização anterior falhou"));
  await previousCenter;
  assert.equal(f.state.notice, "");
  assert.equal(f.state.gpsBusy, true);
  f.pending[3].resolve(originB);
  await latest;
  assert.equal(f.state.originPoint, originB);
  assert.equal(f.state.gpsBusy, false);
});

test("permissão automática atrasada não inicia GPS depois de uma origem manual mais recente", async () => {
  const f = fixture();
  f.startAutomatic();
  f.confirmOrigin(originB);
  f.permission.resolve({ state: "granted" });
  await flush();
  assert.equal(f.pending.length, 0);
  assert.equal(f.state.originPoint, originB);
  assert.equal(f.state.gpsBusy, false);
});

test("permissão já concedida continua obtendo origem automaticamente se o usuário não mudou o pedido", async () => {
  const f = fixture();
  f.startAutomatic();
  f.permission.resolve({ state: "granted" });
  await flush();
  assert.equal(f.pending.length, 1);
  f.pending[0].resolve(gpsPoint);
  await flush();
  assert.equal(f.state.originPoint, gpsPoint);
  assert.equal(f.state.gpsBusy, false);
});
