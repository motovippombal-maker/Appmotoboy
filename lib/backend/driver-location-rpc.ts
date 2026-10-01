export function driverLocationRpcArgs(input: {
  driverId: string;
  rideId?: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  heading?: number;
  speedMps?: number;
  recordedAt: string;
}) {
  return {
    p_driver_id: input.driverId,
    p_ride_id: input.rideId ?? null,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_meters: input.accuracyMeters ?? null,
    p_heading: input.heading ?? null,
    p_speed_mps: input.speedMps ?? null,
    p_recorded_at: input.recordedAt,
  };
}
