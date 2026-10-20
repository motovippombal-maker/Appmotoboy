import { newerLocation, type TimedLocation } from "@/lib/tracking/realtime";

type RideAssignment = { id: string; driver_id?: string | null; status: string };

export type DriverLocationState<T extends TimedLocation> = {
  rideId: string;
  driverId: string;
  location: T | null;
} | null;

export function mergeDriverLocationSnapshot<T extends TimedLocation>(
  current: DriverLocationState<T>,
  ride: RideAssignment | null,
  incoming: T | null,
): DriverLocationState<T> {
  if (!ride?.driver_id || ["finalizada", "cancelada"].includes(ride.status)) return null;
  const sameAssignment = current?.rideId === ride.id && current.driverId === ride.driver_id;
  const previous = sameAssignment ? current.location : null;
  // HTTP snapshots carry the ride separately from its location. Realtime carries both.
  const scopedIncoming = incoming ? { ...incoming, rideId: incoming.rideId ?? ride.id } : null;
  return {
    rideId: ride.id,
    driverId: ride.driver_id,
    location: scopedIncoming ? newerLocation(previous, scopedIncoming, ride.id) : previous,
  };
}

export function mergeDriverLocationEvent<T extends TimedLocation>(
  current: DriverLocationState<T>,
  rideId: string,
  driverId: string,
  incoming: T,
): DriverLocationState<T> {
  // A removed subscription may still finish delivering an event for its old driver.
  if (!current || current.rideId !== rideId || current.driverId !== driverId) return current;
  const location = newerLocation(current.location, incoming, rideId);
  return location === current.location ? current : { ...current, location };
}
