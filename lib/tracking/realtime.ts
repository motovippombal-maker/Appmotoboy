import { distanceKm } from "@/lib/backend/routing";
import { isValidCoordinates } from "@/lib/location/coordinates";

export type RealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type TimedLocation = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  updatedAt: string;
  rideId?: string | null;
};

export type EtaPhase = "pickup" | "trip";

export function normalizeRealtimeStatus(status: string): RealtimeConnectionState {
  switch (status.toUpperCase()) {
    case "SUBSCRIBED":
      return "connected";
    case "CLOSED":
      return "disconnected";
    case "CHANNEL_ERROR":
    case "TIMED_OUT":
      return "error";
    default:
      return "connecting";
  }
}

export function shouldResynchronizeRealtime(
  previous: RealtimeConnectionState,
  next: RealtimeConnectionState,
) {
  return next === "connected" && previous !== "connected";
}

export function newerLocation<T extends TimedLocation>(
  current: T | null,
  incoming: T,
  expectedRideId?: string,
) {
  if (!isValidCoordinates(incoming)) return current;
  if (expectedRideId && incoming.rideId !== expectedRideId) return current;
  const incomingTime = new Date(incoming.updatedAt).getTime();
  if (!Number.isFinite(incomingTime)) return current;
  if (current && incomingTime <= new Date(current.updatedAt).getTime()) {
    return current;
  }
  return incoming;
}

export function isLocationFresh(
  location: TimedLocation | null,
  freshnessSeconds: number,
  now = Date.now(),
) {
  if (!location || !isValidCoordinates(location)) return false;
  const timestamp = new Date(location.updatedAt).getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp >= now - freshnessSeconds * 1000 &&
    timestamp <= now + 30_000
  );
}

export type LocationSample = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  timestamp: number;
};

export function shouldSendLocationUpdate(
  previous: LocationSample | null,
  next: LocationSample,
  activeRide: boolean,
) {
  if (!isValidCoordinates(next) || !Number.isFinite(next.accuracyMeters)) {
    return false;
  }
  if (!previous) return true;
  if (next.timestamp <= previous.timestamp) return false;
  const elapsed = next.timestamp - previous.timestamp;
  const minimumInterval = activeRide ? 5_000 : 20_000;
  const maximumInterval = activeRide ? 20_000 : 60_000;
  if (elapsed < minimumInterval) return false;
  if (elapsed >= maximumInterval) return true;
  const displacement =
    distanceKm(previous, next) * 1000;
  const significantDistance = Math.max(
    activeRide ? 8 : 20,
    Math.min(100, Math.max(previous.accuracyMeters, next.accuracyMeters)),
  );
  return displacement >= significantDistance;
}

export function trackingPhase(status?: string | null): EtaPhase | null {
  if (["aceita", "motorista_a_caminho", "motorista_chegou"].includes(status || "")) {
    return "pickup";
  }
  if (status === "em_corrida") return "trip";
  return null;
}

export function etaTarget(
  status: string,
  ride: {
    origin_lat: number;
    origin_lng: number;
    destination_lat: number;
    destination_lng: number;
  },
) {
  const phase = trackingPhase(status);
  if (!phase) return null;
  return phase === "pickup"
    ? { phase, lat: ride.origin_lat, lng: ride.origin_lng }
    : { phase, lat: ride.destination_lat, lng: ride.destination_lng };
}

export type EtaCalculation = {
  phase: EtaPhase;
  location: TimedLocation;
  calculatedAt: number;
};

export function shouldRecalculateEta(
  previous: EtaCalculation | null,
  phase: EtaPhase,
  location: TimedLocation,
  now = Date.now(),
) {
  if (!previous || previous.phase !== phase) return true;
  const elapsed = now - previous.calculatedAt;
  if (elapsed < 15_000) return false;
  if (elapsed >= 45_000) return true;
  const displacement = distanceKm(previous.location, location) * 1000;
  const threshold = Math.max(
    25,
    Math.min(100, location.accuracyMeters || 25),
  );
  return displacement >= threshold;
}

export function shouldRefreshNearbyDrivers(input: {
  role: string;
  hasActiveRide: boolean;
  driverOnline?: boolean;
  driverAvailable?: boolean;
}) {
  return (
    input.role === "passenger" &&
    !input.hasActiveRide &&
    (input.driverOnline === true || input.driverOnline === false) &&
    (input.driverAvailable === true || input.driverAvailable === false)
  );
}

export function externalNavigationTarget(
  status: string,
  ride: {
    origin_lat: number;
    origin_lng: number;
    destination_lat: number;
    destination_lng: number;
  },
) {
  const target = etaTarget(status, ride);
  if (!target) return null;
  return {
    lat: target.lat,
    lng: target.lng,
    url: `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`,
  };
}
