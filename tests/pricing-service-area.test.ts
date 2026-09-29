import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PricingRuleError,
  resolveFareRule,
  type FareRegionRule,
  type ServiceAreaRule,
} from "../lib/backend/pricing-rules";
import {
  buildQuoteClaims,
  createQuoteToken,
  quoteMatches,
  verifyQuoteToken,
} from "../lib/backend/quote-token";

const TEST_SECRET = "isolated-test-secret-that-is-not-used-in-production";
const UPDATED_AT = "2026-09-28T18:00:00.000Z";
const serviceArea: ServiceAreaRule = {
  id: "area-test",
  name: "Área fictícia de teste",
  boundary: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
  active: true,
  allow_origins: true,
  allow_destinations: true,
  priority: 0,
  updated_at: UPDATED_AT,
};
const defaultFare: FareRegionRule = {
  id: "fare-default",
  name: "Tarifa padrão fictícia",
  amount_cents: 500,
  active: true,
  is_default: true,
  boundary: null,
  priority: 0,
  updated_at: UPDATED_AT,
};
const specialFare: FareRegionRule = {
  id: "fare-special",
  name: "Região especial fictícia",
  amount_cents: 700,
  active: true,
  is_default: false,
  boundary: {
    type: "Polygon",
    coordinates: [
      [
        [4, 4],
        [8, 4],
        [8, 8],
        [4, 8],
        [4, 4],
      ],
    ],
  },
  priority: 10,
  updated_at: UPDATED_AT,
};

function resolve(options: {
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
  areas?: ServiceAreaRule[];
  regions?: FareRegionRule[];
} = {}) {
  return resolveFareRule({
    origin: options.origin ?? { lat: 1, lng: 1 },
    destination: options.destination ?? { lat: 2, lng: 2 },
    serviceAreas: options.areas ?? [serviceArea],
    fareRegions: options.regions ?? [defaultFare, specialFare],
  });
}

function claims(
  resolvedFare: ReturnType<typeof resolve>,
  fareCents = resolvedFare.fareCents,
) {
  return buildQuoteClaims({
    passengerId: "passenger-test",
    origin: { lat: 1, lng: 1 },
    destination: { lat: 2, lng: 2 },
    resolvedFare,
    fareCents,
    originalFareCents: fareCents,
    discountCents: 0,
    couponCode: null,
    now: 1_800_000_000,
  });
}

function expectPricingError(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PricingRuleError);
    assert.equal(error.code, code);
    return true;
  });
}

test("1. destino atendido sem região especial usa tarifa padrão", () => {
  const result = resolve();
  assert.equal(result.fareCents, 500);
  assert.equal(result.fareRegion.id, defaultFare.id);
  assert.equal(result.snapshot.resolution, "default_within_service_area");
});

test("2. destino dentro de região especial usa a tarifa especial", () => {
  const result = resolve({ destination: { lat: 5, lng: 5 } });
  assert.equal(result.fareCents, 700);
  assert.equal(result.fareRegion.id, specialFare.id);
  assert.equal(result.snapshot.resolution, "special_region");
});

test("3. destino fora da área não recebe tarifa urbana padrão", () => {
  expectPricingError(
    () => resolve({ destination: { lat: 20, lng: 20 } }),
    "DESTINATION_OUTSIDE_SERVICE_AREA",
  );
});

test("4. preço adulterado pelo frontend não altera a cotação assinada", () => {
  const serverClaims = claims(resolve());
  const token = createQuoteToken(serverClaims, TEST_SECRET);
  const adulteratedRequest = { fareCents: 1, quoteToken: token };
  const verified = verifyQuoteToken(adulteratedRequest.quoteToken, TEST_SECRET);
  assert.equal(adulteratedRequest.fareCents, 1);
  assert.equal(verified.fareCents, 500);
  assert.throws(() =>
    verifyQuoteToken(`${token.slice(0, -1)}x`, TEST_SECRET),
  );
});

test("5. cotação e confirmação sem alteração preservam o mesmo preço", () => {
  const first = claims(resolve());
  const confirmation = claims(resolve());
  assert.equal(quoteMatches(first, confirmation), true);
  assert.equal(confirmation.fareCents, first.fareCents);
});

test("6. tarifa alterada após a cotação exige nova confirmação", () => {
  const first = claims(resolve());
  const changedDefault = {
    ...defaultFare,
    amount_cents: 700,
    updated_at: "2026-09-28T18:05:00.000Z",
  };
  const refreshed = claims(resolve({ regions: [changedDefault, specialFare] }));
  assert.equal(quoteMatches(first, refreshed), false);
  assert.equal(refreshed.fareCents, 700);
});

test("7. região especial desativada recua para a tarifa padrão", () => {
  const result = resolve({
    destination: { lat: 5, lng: 5 },
    regions: [defaultFare, { ...specialFare, active: false }],
  });
  assert.equal(result.fareCents, 500);
  assert.equal(result.fareRegion.id, defaultFare.id);
});

test("8. coordenadas inválidas produzem erro controlado", () => {
  expectPricingError(
    () => resolve({ destination: { lat: 91, lng: 2 } }),
    "INVALID_COORDINATES",
  );
});

test("9. origem fora da área é bloqueada quando não há permissão", () => {
  expectPricingError(
    () => resolve({ origin: { lat: -20, lng: -20 } }),
    "ORIGIN_OUTSIDE_SERVICE_AREA",
  );
});

test("10. sobreposição escolhe maior prioridade com desempate estável", () => {
  const higherPriority: FareRegionRule = {
    ...specialFare,
    id: "fare-higher-priority",
    name: "B região fictícia",
    amount_cents: 900,
    priority: 20,
  };
  const samePriorityByName: FareRegionRule = {
    ...higherPriority,
    id: "fare-same-priority",
    name: "A região fictícia",
    amount_cents: 800,
  };
  const result = resolve({
    destination: { lat: 5, lng: 5 },
    regions: [
      defaultFare,
      specialFare,
      higherPriority,
      samePriorityByName,
    ],
  });
  assert.equal(result.fareCents, 800);
  assert.equal(result.fareRegion.id, samePriorityByName.id);
});
