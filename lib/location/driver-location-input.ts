import { z } from "zod";

function optionalSensorReading(maximum: number) {
  return z.preprocess((value) => {
    if (value === null) return undefined;
    // Some browsers report unavailable sensor measurements as negative or
    // out-of-range numbers. The coordinates remain useful without them.
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > maximum))
      return undefined;
    return value;
  }, z.number().finite().nonnegative().max(maximum).optional());
}

export const driverLocationInputSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: optionalSensorReading(10_000),
  heading: optionalSensorReading(360),
  speedMps: optionalSensorReading(100),
  rideId: z.string().uuid().optional(),
  recordedAt: z.string().datetime().optional(),
});

export function hasPreciseAccuracy(value: unknown, maximumMeters = 40) {
  if (value === null || value === undefined) return false;
  const accuracy = Number(value);
  return Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= maximumMeters;
}
