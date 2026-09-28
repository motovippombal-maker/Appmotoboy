import { ApiError } from "@/lib/backend/api";

export type FareConfig = {
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumCents: number;
  configured: boolean;
};

type StoredFare = {
  base_cents?: unknown;
  per_km_cents?: unknown;
  per_minute_cents?: unknown;
  minimum_cents?: unknown;
  configured?: unknown;
};

function cents(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseFareConfig(value: unknown): FareConfig {
  const stored = (value || {}) as StoredFare;
  return {
    baseCents: cents(stored.base_cents),
    perKmCents: cents(stored.per_km_cents),
    perMinuteCents: cents(stored.per_minute_cents),
    minimumCents: cents(stored.minimum_cents),
    configured: stored.configured === true,
  };
}

export function requireConfiguredFare(value: unknown) {
  const fare = parseFareConfig(value);
  if (!fare.configured) throw new ApiError(503, "A central ainda precisa confirmar a configuração de tarifas.", "FARE_NOT_CONFIGURED");
  return fare;
}

export function calculateFareCents(fare: FareConfig, distanceMeters: number, durationSeconds: number) {
  const calculated = fare.baseCents
    + distanceMeters / 1000 * fare.perKmCents
    + durationSeconds / 60 * fare.perMinuteCents;
  return Math.max(fare.minimumCents, Math.round(calculated));
}

export function serializeFareConfig(fare: FareConfig) {
  return {
    base_cents: fare.baseCents,
    per_km_cents: fare.perKmCents,
    per_minute_cents: fare.perMinuteCents,
    minimum_cents: fare.minimumCents,
    configured: fare.configured,
  };
}
