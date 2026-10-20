import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

import { ApiError } from "../lib/backend/errors";
import {
  parseAddressQuery,
  reverseAddress,
  searchAddresses,
  searchWithProviders,
  type AddressResult,
  type AddressSearchProvider,
} from "../lib/backend/geocoding";
import { calculateRoute } from "../lib/backend/routing";
import {
  coordinatesFromGeolocation,
  geolocationErrorMessage,
  preserveExactCoordinates,
} from "../lib/location/coordinates";
import {
  mapViewportKey,
  shouldAutoFitViewport,
} from "../lib/map/viewport";
import { routeChevrons } from "../lib/map/route-chevrons";

const normalizedResult: AddressResult = {
  id: "provider-result",
  address: "Rua de Teste, Centro, Cidade de Teste, Bahia",
  shortAddress: "Rua de Teste — Centro — Cidade de Teste/BA",
  lat: -10.123456,
  lng: -38.654321,
  district: "Centro",
  city: "Cidade de Teste",
  state: "Bahia",
  approximate: false,
  provider: "photon",
};

test("1. GPS válido preserva exatamente a coordenada recebida", () => {
  const point = coordinatesFromGeolocation({
    latitude: -10.81234567,
    longitude: -38.57654321,
  });
  assert.deepEqual(point, { lat: -10.81234567, lng: -38.57654321 });
});

test("2. reverse geocoding diferente altera descrição, não coordenadas", async () => {
  const exact = { lat: -10.81234567, lng: -38.57654321 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      place_id: 10,
      lat: "-10.81",
      lon: "-38.57",
      display_name: "Descrição retornada pelo geocoder",
      address: { road: "Rua Descritiva", town: "Cidade de Teste" },
    })) as typeof fetch;
  try {
    const reversed = await reverseAddress(exact.lat, exact.lng);
    assert.equal(reversed.address, "Descrição retornada pelo geocoder");
    assert.equal(reversed.lat, exact.lat);
    assert.equal(reversed.lng, exact.lng);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("3. ponto selecionado manualmente permanece exato", () => {
  const selected = { lat: -10.89999991, lng: -38.50000009 };
  const confirmed = preserveExactCoordinates(selected, normalizedResult);
  assert.deepEqual(
    { lat: confirmed.lat, lng: confirmed.lng },
    selected,
  );
});

test("4. falha do provedor A preserva resultado válido do provedor B", async () => {
  const failing: AddressSearchProvider = {
    id: "nominatim",
    search: async () => {
      throw new Error("provedor indisponível");
    },
  };
  const working: AddressSearchProvider = {
    id: "photon",
    search: async () => [normalizedResult],
  };
  const results = await searchWithProviders(
    parseAddressQuery("Rua de Teste"),
    [failing, working],
  );
  assert.deepEqual(results, [normalizedResult]);
});

test("5. falha de todos os provedores retorna erro controlado", async () => {
  const failing = (id: "nominatim" | "photon"): AddressSearchProvider => ({
    id,
    search: async () => {
      throw new Error("indisponível");
    },
  });
  await assert.rejects(
    searchWithProviders(parseAddressQuery("Rua de Teste"), [
      failing("nominatim"),
      failing("photon"),
    ]),
    (error: unknown) =>
      error instanceof ApiError && error.code === "GEOCODING_UNAVAILABLE",
  );
});

test("6. permissão de GPS negada mantém alternativas manuais claras", () => {
  const message = geolocationErrorMessage(1);
  assert.match(message, /Permissão/);
  assert.match(message, /Pesquise ou selecione/);
});

test("7. timeout do GPS encerra com mensagem controlada", () => {
  const message = geolocationErrorMessage(3);
  assert.match(message, /demorou/);
  assert.match(message, /mapa/);
});

test("8. atualização irrelevante não solicita novo enquadramento", () => {
  const key = mapViewportKey({
    origin: { lat: -10.8, lng: -38.5 },
    destination: { lat: -10.9, lng: -38.6 },
    route: [[-10.8, -38.5], [-10.9, -38.6]],
  });
  assert.equal(shouldAutoFitViewport(key, key), false);
});

test("9. nova rota válida solicita enquadramento de origem e destino", () => {
  const previous = mapViewportKey({
    origin: { lat: -10.8, lng: -38.5 },
    destination: { lat: -10.9, lng: -38.6 },
    route: [[-10.8, -38.5], [-10.9, -38.6]],
  });
  const next = mapViewportKey({
    origin: { lat: -10.8, lng: -38.5 },
    destination: { lat: -10.9, lng: -38.6 },
    route: [[-10.8, -38.5], [-10.85, -38.58], [-10.9, -38.6]],
  });
  assert.equal(shouldAutoFitViewport(previous, next), true);
});

test("9a. chevrons ficam espaçados na geometria real e acompanham as curvas", () => {
  const arrows = routeChevrons([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 50);
  assert.equal(arrows.length, 3);
  assert.ok(arrows[0][1].x > arrows[0][0].x);
  assert.ok(arrows[2][1].y > arrows[2][0].y);
  assert.ok(arrows.every((arrow) => arrow.every((point) =>
    Math.min(Math.abs(point.y), Math.abs(point.x - 100)) <= 3.3,
  )));
  assert.deepEqual(routeChevrons([{ x: 0, y: 0 }, { x: 20, y: 0 }]), []);
});

test("10. falha do OSRM não fabrica distância ou duração", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("falha de rede");
  }) as typeof fetch;
  try {
    await assert.rejects(
      calculateRoute(
        { lat: -10.8, lng: -38.5 },
        { lat: -10.9, lng: -38.6 },
      ),
      (error: unknown) =>
        error instanceof ApiError && error.code === "ROUTING_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11. pesquisa explícita entrega resultados normalizados", async () => {
  const provider: AddressSearchProvider = {
    id: "photon",
    search: async (query) => {
      assert.equal(query.normalized, "Rua de Teste");
      return [normalizedResult];
    },
  };
  const results = await searchWithProviders(
    parseAddressQuery("  Rua   de   Teste  "),
    [provider],
  );
  assert.equal(results[0].district, "Centro");
  assert.equal(results[0].provider, "photon");
});

test("12. rua com número ausente retorna resultado marcado como aproximado", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("photon.komoot.io")) {
      return Response.json({
        features: [
          {
            properties: {
              osm_id: 1,
              street: "Rua Silva Brito",
              district: "Centro",
              city: "Ribeira do Pombal",
              state: "Bahia",
              country: "Brasil",
            },
            geometry: { coordinates: [-38.5, -10.8] },
          },
        ],
      });
    }
    return Response.json([
      {
        place_id: 2,
        lat: "-10.8",
        lon: "-38.5",
        display_name: "Rua Silva Brito, Centro, Ribeira do Pombal, Bahia",
        address: {
          road: "Rua Silva Brito",
          suburb: "Centro",
          town: "Ribeira do Pombal",
          state: "Bahia",
        },
      },
    ]);
  }) as typeof fetch;
  try {
    const query = parseAddressQuery("Rua Silva Brito, 500");
    assert.equal(query.street, "Rua Silva Brito");
    assert.equal(query.number, "500");
    const results = await searchAddresses(query.normalized);
    assert.ok(results.length > 0);
    assert.ok(results.every((result) => result.approximate));
    assert.ok(results.every((result) => !result.address.includes("500")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("13. ponto predefinido usa latitude e longitude salvas sem geocodificar novamente", async () => {
  const page = await source("app/page.tsx");
  const start = page.indexOf("function chooseQuickPlace");
  const end = page.indexOf("\n  function ", start + 1);
  const handler = page.slice(start, end);
  assert.match(handler, /lat: place\.latitude/);
  assert.match(handler, /lng: place\.longitude/);
  assert.match(handler, /setDestinationPoint\(result\)/);
  assert.match(handler, /calculate\(result\)/);
  assert.doesNotMatch(handler, /chooseDestination|searchAddresses|geocod/i);
});

test("14. estimativa e criação da corrida preservam a coordenada oficial do destino", async () => {
  const estimate = await source("app/api/maps/estimate/route.ts");
  assert.match(estimate, /if \(input\.lat !== undefined && input\.lng !== undefined\) return \{ address: input\.address, lat: input\.lat, lng: input\.lng \}/);
  const request = await source("app/api/rides/request/route.ts");
  assert.match(request, /destination_lat: input\.destination\.lat/);
  assert.match(request, /destination_lng: input\.destination\.lng/);
});

test("15. somente pontos ativos chegam ao passageiro", async () => {
  const route = await source("app/api/quick-places/route.ts");
  assert.match(route, /\.eq\("active", true\)/);
});

test("16. mapa não mantém marcadores de cidade com coordenadas duplicadas no código", async () => {
  const map = await source("components/map/real-map.tsx");
  assert.doesNotMatch(map, /CITY_PLACES|placeMarkersRef/);
  assert.match(map, /draggable: true/);
  assert.match(map, /marker\.on\("dragend"/);
});

async function adminPlaceActions() {
  const admin = await source("components/admin/operations-panel.tsx");
  const parsed = ts.createSourceFile("operations-panel.tsx", admin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(predicate: (node: ts.Node) => boolean, node: ts.Node = parsed): ts.Node | undefined {
    if (predicate(node)) return node;
    return ts.forEachChild(node, (child) => find(predicate, child));
  }
  function attribute(node: ts.Node, name: string) {
    const value = find((child) => ts.isJsxAttribute(child) && child.name.getText(parsed) === name, node);
    if (!value || !ts.isJsxAttribute(value) || !value.initializer) return undefined;
    return ts.isJsxExpression(value.initializer) ? value.initializer.expression?.getText(parsed) : value.initializer.getText(parsed);
  }
  const functions = ["run", "invalidatePlaceGeocode", "closePlaceEditor", "editPlace", "savePlace", "placeCoordinates", "confirmPlaceLocation"].map((name) =>
    find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText(parsed) ?? "");
  const emptyPlace = find((node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "emptyPlace");
  assert.ok(emptyPlace && ts.isVariableDeclaration(emptyPlace) && emptyPlace.initializer);
  const geocode = find((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "button" &&
    Boolean(attribute(node, "onClick")?.includes("backend.geocodeQuickPlace")));
  const map = find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "RealMap" && attribute(node, "pickPoint") === "mapPoint");
  const latitude = find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "input" && attribute(node, "value") === "placeForm.latitude");
  const longitude = find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "input" && attribute(node, "value") === "placeForm.longitude");
  const address = find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "input" && attribute(node, "value") === "placeForm.address");
  const confirm = find((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "button" && attribute(node, "onClick") === "confirmPlaceLocation");
  const cancel = find((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "button" &&
    ts.isJsxElement(node.parent) && node.parent.children.some((child) => ts.isJsxText(child) && child.getText(parsed).trim() === "Cancelar"));
  assert.ok(geocode && map && latitude && longitude && address && cancel);
  const saved: Array<Record<string, unknown>> = [];
  const geocoded = { address: "Endereço sugerido", latitude: -10.8123456789, longitude: -38.5765432198 };
  const context = createContext({
    placeForm: {}, mapPoint: null, busy: "", message: "", placeEditor: true, placeGeocodeRef: { current: 0 },
    backend: { quickPlaces: [], refresh: async () => {}, geocodeQuickPlace: async () => geocoded,
      saveQuickPlace: async (payload: Record<string, unknown>) => { saved.push(payload); } },
  });
  for (const field of ["Busy", "Message", "MapPoint", "PlaceEditor"])
    context[`set${field}`] = (value: unknown) => {
      const key = field[0].toLowerCase() + field.slice(1);
      context[key] = typeof value === "function" ? value(context[key]) : value;
    };
  context.setPlaceForm = (update: unknown) => { context.placeForm = typeof update === "function" ? update(context.placeForm) : update; };
  const code = `const emptyPlace = ${emptyPlace.initializer.getText(parsed)};\n${functions.join("\n")}\n` +
    `const geocodeAction = ${attribute(geocode, "onClick")};\nconst pickMapPoint = ${attribute(map, "onPick")};\n` +
    `const changeLatitude = ${attribute(latitude, "onChange")};\nconst changeLongitude = ${attribute(longitude, "onChange")};\n` +
    `const changeAddress = ${attribute(address, "onChange")};\n` +
    `const cancelPlace = ${attribute(cancel, "onClick")};\n` +
    `const confirmationDisabled = () => ${confirm ? attribute(confirm, "disabled") : "true"};\nplaceForm = { ...emptyPlace(0), name: "Local teste", address: "Rua de teste" };`;
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return {
    saved, geocoded, context,
    form: () => context.placeForm as { latitude: string; longitude: string; locationVerified: boolean },
    geocode: async () => { runInContext("geocodeAction()", context); await new Promise<void>((done) => setImmediate(done)); },
    save: () => runInContext("savePlace({ preventDefault() {} })", context) as Promise<void>,
    pick: (point: { lat: number; lng: number }) => { context.point = point; runInContext("pickMapPoint(point)", context); },
    edit: (place: Record<string, unknown>) => { context.place = place; runInContext("editPlace(place)", context); },
    confirm: () => runInContext("confirmPlaceLocation()", context),
    close: () => runInContext("cancelPlace()", context),
    confirmationDisabled: () => runInContext("confirmationDisabled()", context) as boolean,
    hasKeyboardButton: () => Boolean(confirm && attribute(confirm, "type") === '"button"'),
    address: (value: string) => { context.addressEvent = { target: { value } }; runInContext("changeAddress(addressEvent)", context); },
    coordinates: (lat: string, lng: string) => {
      context.latitudeEvent = { target: { value: lat } }; context.longitudeEvent = { target: { value: lng } };
      runInContext("changeLatitude(latitudeEvent); changeLongitude(longitudeEvent);", context);
    },
  };
}

test("17. painel ativo exige confirmação explícita do PIN depois da geocodificação", async () => {
  const actions = await adminPlaceActions();
  await actions.geocode();
  assert.equal(actions.form().locationVerified, false);
  await actions.save();
  assert.equal(actions.saved.length, 0);
  assert.match(String(actions.context.message), /Confirme a localização/);
  assert.ok(actions.hasKeyboardButton());
  actions.confirm();
  await actions.save();
  assert.equal(actions.saved.length, 1);
  assert.equal(actions.saved[0].latitude, actions.geocoded.latitude);
  assert.equal(actions.saved[0].longitude, actions.geocoded.longitude);
  assert.equal(actions.saved[0].locationVerified, true);
  const adminRoute = await source("app/api/admin/quick-places/route.ts");
  assert.match(adminRoute, /input\.active && !input\.locationVerified/);
});

test("18. clique ou arrasto confirma as coordenadas exatas sem arredondá-las", async () => {
  const actions = await adminPlaceActions();
  const point = { lat: -10.8123456789, lng: -38.5765432198 };
  actions.pick(point);
  assert.equal(actions.form().locationVerified, true);
  await actions.save();
  assert.equal(actions.saved[0].latitude, point.lat);
  assert.equal(actions.saved[0].longitude, point.lng);
});

test("19. teclado confirma coordenadas válidas e impede confirmação vazia ou fora dos limites", async () => {
  const actions = await adminPlaceActions();
  assert.ok(actions.hasKeyboardButton());
  assert.equal(actions.confirmationDisabled(), true);
  actions.confirm();
  assert.equal(actions.form().locationVerified, false);
  actions.coordinates("91", "-38.5765432198");
  assert.equal(actions.confirmationDisabled(), true);
  actions.confirm();
  assert.equal(actions.form().locationVerified, false);
  actions.coordinates("-10.8123456789", "-38.5765432198");
  assert.equal(actions.form().locationVerified, false);
  assert.equal(actions.confirmationDisabled(), false);
  // Botão nativo type=button recebe Enter/Space sem depender de eventos de ponteiro.
  actions.confirm();
  assert.equal(actions.form().locationVerified, true);
  assert.equal((actions.context.mapPoint as { lat: number }).lat, -10.8123456789);
  await actions.save();
  assert.equal(actions.saved[0].latitude, -10.8123456789);
});

test("20. editar ponto existente preserva sua localização confirmada até o endereço ou coordenadas mudarem", async () => {
  const actions = await adminPlaceActions();
  const existing = { id: "place-existing", name: "Local", address: "Endereço cadastrado", latitude: -10.8123456789,
    longitude: -38.5765432198, category: "generic", icon: "pin", color: "#1688ff", active: true, featured: false, sort_order: 10 };
  actions.edit(existing);
  assert.equal(actions.form().locationVerified, true);
  await actions.save();
  assert.equal(actions.saved[0].id, existing.id);
  assert.equal(actions.saved[0].latitude, existing.latitude);
  actions.edit(existing);
  actions.address("Outro endereço cadastrado");
  assert.equal(actions.form().locationVerified, false);
  await actions.save();
  assert.equal(actions.saved.length, 1);
  actions.edit(existing);
  actions.coordinates("-10.82", "-38.58");
  assert.equal(actions.form().locationVerified, false);
  await actions.save();
  assert.equal(actions.saved.length, 1);
});

function deferredGeocode() {
  let resolve!: (result: { address: string; latitude: number; longitude: number }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ address: string; latitude: number; longitude: number }>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flushAdmin = () => new Promise<void>((done) => setImmediate(done));

test("21. geocodificação atrasada não desfaz PIN manual escolhido durante a busca", async () => {
  const actions = await adminPlaceActions();
  const pending = deferredGeocode();
  actions.context.backend.geocodeQuickPlace = () => pending.promise;
  await actions.geocode();
  const point = { lat: -10.91, lng: -38.61 };
  actions.pick(point);
  pending.resolve(actions.geocoded);
  await flushAdmin();
  assert.equal(Number(actions.form().latitude), point.lat);
  assert.equal(Number(actions.form().longitude), point.lng);
  assert.equal(actions.form().locationVerified, true);
  assert.equal(actions.context.busy, "");
});

test("22. fechar e abrir outro formulário impede resposta antiga de misturar endereço e coordenadas", async () => {
  const actions = await adminPlaceActions();
  const pending = deferredGeocode();
  actions.context.backend.geocodeQuickPlace = () => pending.promise;
  await actions.geocode();
  actions.close();
  const other = { id: "place-B", name: "Local B", address: "Endereço B", latitude: -10.91, longitude: -38.61,
    category: "generic", icon: "pin", color: "#1688ff", active: true, featured: false, sort_order: 20 };
  actions.edit(other);
  pending.resolve(actions.geocoded);
  await flushAdmin();
  assert.equal(actions.context.placeForm.id, other.id);
  assert.equal(actions.context.placeForm.address, other.address);
  assert.equal(Number(actions.form().latitude), other.latitude);
  assert.equal(actions.form().locationVerified, true);
});

test("23. respostas, erros e finally antigos não apagam aviso ou loading de uma nova busca", async () => {
  for (const outcome of ["success", "error"]) {
    const actions = await adminPlaceActions();
    const first = deferredGeocode(), latest = deferredGeocode();
    let calls = 0;
    actions.context.backend.geocodeQuickPlace = () => ++calls === 1 ? first.promise : latest.promise;
    await actions.geocode();
    actions.address("Novo endereço para busca");
    await actions.geocode();
    actions.context.message = "Buscando endereço mais recente";
    if (outcome === "success") first.resolve(actions.geocoded);
    else first.reject(new Error("Falha antiga"));
    await flushAdmin();
    assert.equal(actions.context.busy, "geocode");
    assert.equal(actions.context.message, "Buscando endereço mais recente");
    latest.resolve({ ...actions.geocoded, address: "Novo endereço localizado" });
    await flushAdmin();
    assert.equal(actions.context.busy, "");
    assert.equal(actions.context.placeForm.address, "Novo endereço localizado");
    assert.equal(actions.form().locationVerified, false);
  }
});
