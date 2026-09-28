import { ApiError } from "@/lib/backend/api";

export type Coordinate = { lat: number; lng: number };

type OsrmRoute = { distance: number; duration: number; geometry: string };

export async function calculateRoute(origin: Coordinate, destination: Coordinate) {
  const baseUrl = process.env.ROUTING_BASE_URL || "https://router.project-osrm.org";
  const url = `${baseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  const response = await fetch(url, { headers: { "User-Agent": "MotoVIP/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new ApiError(503, "Não foi possível calcular a rota agora.", "ROUTING_UNAVAILABLE");
  const payload = await response.json() as { routes?: OsrmRoute[] };
  const route = payload.routes?.[0];
  if (!route || route.distance <= 0 || route.duration <= 0) throw new ApiError(422, "Rota não encontrada.", "ROUTE_NOT_FOUND");
  return { distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), geometry: JSON.stringify(route.geometry) };
}

export function distanceKm(a: Coordinate, b: Coordinate) {
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
