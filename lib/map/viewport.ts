import type { ExactCoordinates } from "@/lib/location/coordinates";

function pointKey(point?: ExactCoordinates) {
  return point ? `${point.lat.toFixed(6)},${point.lng.toFixed(6)}` : "-";
}

export function mapViewportKey(input: {
  origin?: ExactCoordinates;
  destination?: ExactCoordinates;
  route?: Array<[number, number]>;
}) {
  const routeKey = (input.route || [])
    .map(([lat, lng]) => `${lat.toFixed(6)},${lng.toFixed(6)}`)
    .join(";");
  if (!input.origin && !input.destination && !routeKey) return "";
  return `${pointKey(input.origin)}|${pointKey(input.destination)}|${routeKey}`;
}

export function shouldAutoFitViewport(previousKey: string, nextKey: string) {
  return Boolean(nextKey) && previousKey !== nextKey;
}
