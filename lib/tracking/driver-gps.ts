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
