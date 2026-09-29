import assert from "node:assert/strict";
import { test } from "node:test";

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
