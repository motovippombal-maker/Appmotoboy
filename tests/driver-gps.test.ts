import assert from "node:assert/strict";
import { test } from "node:test";
import { driverGpsSampleIssue, shouldAcceptGpsFix } from "../lib/tracking/driver-gps";

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

test("GPS descarta dados vencidos ou do futuro antes de atualizar a última posição", () => {
  const valid = { timestamp: 100_000, coords: { latitude: -10.8373, longitude: -38.5357, accuracy: 22 } } as GeolocationPosition;
  assert.equal(driverGpsSampleIssue(valid, 101_000), null);
  assert.equal(driverGpsSampleIssue(valid, 131_000), "timestamp");
  assert.equal(driverGpsSampleIssue({ ...valid, timestamp: 110_000 }, 101_000), "timestamp");
  assert.equal(driverGpsSampleIssue({ ...valid, timestamp: NaN }, 101_000), "timestamp");
  assert.equal(driverGpsSampleIssue({ ...valid, coords: { ...valid.coords, accuracy: -3 } }, 101_000), "accuracy");
  assert.equal(driverGpsSampleIssue({ ...valid, coords: { ...valid.coords, latitude: Infinity } }, 101_000), "coordinates");
});
