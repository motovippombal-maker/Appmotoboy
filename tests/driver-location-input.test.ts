import assert from "node:assert/strict";
import { test } from "node:test";
import { driverLocationInputSchema, hasPreciseAccuracy } from "../lib/location/driver-location-input";

test("posição válida não é perdida por leituras opcionais imprecisas do sensor", () => {
  const input = driverLocationInputSchema.parse({
    latitude: -10.84, longitude: -38.54,
    accuracyMeters: 25_000, heading: -1, speedMps: -1,
    recordedAt: "2026-10-02T03:30:00.000Z",
  });
  assert.equal(input.latitude, -10.84);
  assert.equal(input.accuracyMeters, undefined);
  assert.equal(input.heading, undefined);
  assert.equal(input.speedMps, undefined);
});

test("campos obrigatórios continuam validados", () => {
  assert.equal(driverLocationInputSchema.safeParse({ latitude: 200, longitude: -38 }).success, false);
  assert.equal(driverLocationInputSchema.safeParse({ latitude: -10, longitude: -38, rideId: "inválido" }).success, false);
});

test("chegada nunca considera precisão ausente como GPS preciso", () => {
  assert.equal(hasPreciseAccuracy(null), false);
  assert.equal(hasPreciseAccuracy(undefined), false);
  assert.equal(hasPreciseAccuracy("12"), true);
  assert.equal(hasPreciseAccuracy("80"), false);
});
