import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAcceptGpsFix } from "../lib/tracking/driver-gps";

function fix(timestamp: number, accuracy: number) {
  return { timestamp, coords: { accuracy } } as GeolocationPosition;
}

test("GPS mantém posição recente e precisa durante fallback impreciso", () => {
  const current = fix(100_000, 12);
  assert.equal(shouldAcceptGpsFix(current, fix(105_000, 500), 105_000), false);
  assert.equal(shouldAcceptGpsFix(current, fix(105_000, 20), 105_000), true);
});

test("GPS aceita posição nova quando a anterior envelheceu", () => {
  const current = fix(100_000, 12);
  assert.equal(shouldAcceptGpsFix(current, fix(121_000, 500), 121_000), true);
  assert.equal(shouldAcceptGpsFix(current, fix(99_000, 5), 121_000), false);
});
