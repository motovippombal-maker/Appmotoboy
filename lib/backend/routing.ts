import { ApiError } from "@/lib/backend/errors";
import { isValidCoordinates } from "@/lib/location/coordinates";

export type Coordinate = { lat: number; lng: number };

export type RouteStep = {
  distanceMeters: number;
  location: [number, number];
  type: string;
  modifier?: string;
  road: string;
};

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { type: string; coordinates: number[][] };
  legs?: Array<{ steps?: Array<{
    distance: number;
    name?: string;
    maneuver: { location: [number, number]; type: string; modifier?: string };
  }> }>;
};

export async function calculateRoute(origin: Coordinate, destination: Coordinate, withSteps = false) {
  if (!isValidCoordinates(origin) || !isValidCoordinates(destination)) {
    throw new ApiError(
      400,
      "As coordenadas da rota são inválidas.",
      "INVALID_ROUTE_COORDINATES",
    );
  }
  const baseUrl = process.env.ROUTING_BASE_URL || "https://router.project-osrm.org";
  const url = `${baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson${withSteps ? "&steps=true" : ""}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": "MotoPombal/1.0" }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ApiError(503, "Não foi possível calcular a rota agora.", "ROUTING_UNAVAILABLE");
  }
  if (!response.ok) throw new ApiError(503, "Não foi possível calcular a rota agora.", "ROUTING_UNAVAILABLE");
  let payload: { routes?: OsrmRoute[] };
  try {
    payload = await response.json() as { routes?: OsrmRoute[] };
  } catch {
    throw new ApiError(503, "Não foi possível calcular a rota agora.", "ROUTING_UNAVAILABLE");
  }
  const route = payload.routes?.[0];
  if (!route || route.distance <= 0 || route.duration <= 0 || route.geometry?.type !== "LineString" ||
      !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2 ||
      !route.geometry.coordinates.every((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])))
    throw new ApiError(422, "Rota não encontrada.", "ROUTE_NOT_FOUND");
  const steps: RouteStep[] = withSteps
    ? (route.legs || []).flatMap((leg) => leg.steps || []).map((step) => ({
        distanceMeters: Math.round(step.distance),
        location: step.maneuver.location,
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
        road: step.name || "",
      }))
    : [];
  const result = { distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), geometry: JSON.stringify(route.geometry) };
  return withSteps ? { ...result, steps } : result;
}

export function distanceKm(a: Coordinate, b: Coordinate) {
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
