import type { RouteStep } from "@/lib/backend/routing";

export type NavPoint = { lat: number; lng: number };

export function metersBetween(a: NavPoint, b: NavPoint) {
  const latitude = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const north = (b.lat - a.lat) * 111_195;
  const east = (b.lng - a.lng) * 111_195 * Math.cos(latitude);
  return Math.hypot(north, east);
}

export function routeProgress(point: NavPoint, route: Array<[number, number]>) {
  if (route.length < 2) return { remainingMeters: 0, offRouteMeters: Infinity, traveledMeters: 0 };
  let traveled = 0;
  let best = { offRouteMeters: Infinity, traveledMeters: 0 };
  for (let index = 1; index < route.length; index++) {
    const start = { lat: route[index - 1][0], lng: route[index - 1][1] };
    const end = { lat: route[index][0], lng: route[index][1] };
    const scale = Math.cos(point.lat * Math.PI / 180);
    const dx = (end.lng - start.lng) * scale;
    const dy = end.lat - start.lat;
    const fraction = Math.max(0, Math.min(1, ((point.lng - start.lng) * scale * dx + (point.lat - start.lat) * dy) / (dx * dx + dy * dy || 1)));
    const projected = { lat: start.lat + (end.lat - start.lat) * fraction, lng: start.lng + (end.lng - start.lng) * fraction };
    const distance = metersBetween(point, projected);
    const segment = metersBetween(start, end);
    if (distance < best.offRouteMeters) best = { offRouteMeters: distance, traveledMeters: traveled + segment * fraction };
    traveled += segment;
  }
  return { ...best, remainingMeters: Math.max(0, traveled - best.traveledMeters) };
}

export function nextManeuver(point: NavPoint, route: Array<[number, number]>, steps: RouteStep[]) {
  const progress = routeProgress(point, route);
  const candidates = steps
    .filter((step) => !["depart", "arrive", "notification"].includes(step.type))
    .map((step) => ({ step, distanceMeters: routeProgress({ lat: step.location[1], lng: step.location[0] }, route).traveledMeters - progress.traveledMeters }))
    .filter(({ distanceMeters }) => distanceMeters >= -15);
  return candidates[0] || null;
}

export function maneuverText(step: RouteStep) {
  const modifier = step.modifier || "straight";
  const action = step.type === "roundabout" || step.type === "rotary"
    ? "Entre na rotatória"
    : modifier === "uturn" ? "Faça o retorno"
    : modifier.includes("right")
      ? "Vire à direita"
      : modifier.includes("left")
        ? "Vire à esquerda"
        : "Siga em frente";
  return step.road ? `${action} — ${step.road}` : action;
}

export function maneuverSymbol(step?: RouteStep) {
  if (!step) return "↑";
  if (step.type === "roundabout" || step.type === "rotary") return "↻";
  if (step.modifier === "uturn") return "↶";
  if (step.modifier?.includes("right")) return "↱";
  if (step.modifier?.includes("left")) return "↰";
  return "↑";
}

export function formatNavDistance(meters: number) {
  return meters < 1000 ? `${Math.max(0, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function navigationZoom(speedMps: number | null, turnMeters: number | null) {
  if (turnMeters !== null && turnMeters < 130) return 18;
  if (speedMps !== null && speedMps > 16) return 15;
  if (speedMps !== null && speedMps > 8) return 16;
  return 17;
}

export function shouldReroute(offRouteMeters: number, accuracyMeters: number, consecutiveSamples: number, lastRequestAt: number, now: number) {
  return accuracyMeters <= 80 && offRouteMeters > Math.max(45, accuracyMeters * 1.5) && consecutiveSamples >= 2 && now - lastRequestAt >= 20_000;
}
