import { isValidCoordinates } from "@/lib/location/coordinates";

/** Rejects cached/future/invalid samples before they advance the GPS watermark. */
export function driverGpsSampleIssue(position: Pick<GeolocationPosition, "timestamp" | "coords">, now = Date.now()) {
  const { latitude: lat, longitude: lng, accuracy } = position.coords;
  if (!isValidCoordinates({ lat, lng })) return "coordinates";
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10_000) return "accuracy";
  if (!Number.isFinite(position.timestamp) || position.timestamp < now - 30_000 || position.timestamp > now + 5_000) return "timestamp";
  return null;
}

/** Keep a recent accurate fix when a network fallback reports a much wider area. */
export function shouldAcceptGpsFix(
  current: Pick<GeolocationPosition, "timestamp" | "coords"> | null,
  next: Pick<GeolocationPosition, "timestamp" | "coords">,
  now = Date.now(),
) {
  if (!current) return true;
  if (next.timestamp <= current.timestamp) return false;
  return !(now - current.timestamp < 20_000 && current.coords.accuracy <= 40 &&
    next.coords.accuracy > Math.max(80, current.coords.accuracy * 3));
}
