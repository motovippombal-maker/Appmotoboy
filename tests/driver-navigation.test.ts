import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRoute } from "../lib/backend/routing";

import {
  formatNavDistance,
  maneuverSymbol,
  maneuverText,
  metersBetween,
  navigationZoom,
  nextManeuver,
  routeProgress,
  shouldReroute,
} from "../lib/navigation/driver-navigation";

const road: Array<[number, number]> = [[-10, -38], [-10, -37.999], [-9.999, -37.999]];

test("route progress follows the road and detects lateral deviation", () => {
  const position = { lat: -10, lng: -37.9995 };
  const progress = routeProgress(position, road);
  assert.ok(progress.traveledMeters > 50 && progress.traveledMeters < 60);
  assert.ok(progress.remainingMeters > 150);
  assert.ok(progress.offRouteMeters < 1);
  assert.ok(routeProgress({ lat: -10.001, lng: -37.9995 }, road).offRouteMeters > 100);
});

test("next maneuver advances after a turn", () => {
  const steps = [
    { distanceMeters: 110, location: [-38, -10] as [number, number], type: "depart", road: "" },
    { distanceMeters: 110, location: [-37.999, -10] as [number, number], type: "turn", modifier: "right", road: "Rua A" },
    { distanceMeters: 0, location: [-37.999, -9.999] as [number, number], type: "arrive", road: "" },
  ];
  const next = nextManeuver({ lat: -10, lng: -37.9995 }, road, steps);
  assert.equal(next?.step.road, "Rua A");
  assert.ok((next?.distanceMeters || 0) > 50);
  assert.equal(nextManeuver({ lat: -9.9995, lng: -37.999 }, road, steps), null);
  assert.equal(maneuverText(steps[1]), "Vire à direita — Rua A");
  assert.equal(maneuverSymbol(steps[1]), "↱");
});

test("reroute requires reliable GPS, repeated deviation and cooldown", () => {
  assert.equal(shouldReroute(75, 12, 1, 0, 30_000), false);
  assert.equal(shouldReroute(75, 12, 2, 0, 30_000), true);
  assert.equal(shouldReroute(75, 12, 2, 25_000, 30_000), false);
  assert.equal(shouldReroute(150, 95, 2, 0, 30_000), false);
});

test("navigation metrics and zoom are legible", () => {
  assert.ok(metersBetween({ lat: -10, lng: -38 }, { lat: -10, lng: -37.999 }) > 100);
  assert.equal(formatNavDistance(128), "130 m");
  assert.equal(formatNavDistance(1200), "1,2 km");
  assert.equal(navigationZoom(20, 1000), 15);
  assert.equal(navigationZoom(20, 50), 18);
});

test("driver route requests OSRM turn steps without changing fare routes", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ routes: [{
      distance: 230,
      duration: 42,
      geometry: { type: "LineString", coordinates: [[-38, -10], [-37.999, -10]] },
      legs: [{ steps: [{ distance: 110, name: "Rua A", maneuver: { location: [-37.999, -10], type: "turn", modifier: "right" } }] }],
    }] });
  };
  try {
    const navigation = await calculateRoute({ lat: -10, lng: -38 }, { lat: -10, lng: -37.999 }, true);
    const fare = await calculateRoute({ lat: -10, lng: -38 }, { lat: -10, lng: -37.999 });
    assert.ok("steps" in navigation);
    assert.equal(navigation.steps[0].road, "Rua A");
    assert.equal(navigation.steps[0].modifier, "right");
    assert.equal("steps" in fare, false);
    assert.match(urls[0], /steps=true/);
    assert.doesNotMatch(urls[1], /steps=true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resposta de rota sem geometria não confirma ETA com mapa vazio", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ routes: [{ distance: 230, duration: 42 }] });
  try {
    await assert.rejects(calculateRoute({ lat: -10, lng: -38 }, { lat: -10, lng: -37.999 }, true), /Rota não encontrada/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
