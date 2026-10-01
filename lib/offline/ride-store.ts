import type { Ride, TrackingRoute } from "@/hooks/use-moto-vip";
import type { LocalRoute } from "@/lib/offline/road-graph";
import { OFFLINE_REGION } from "@/lib/offline/region";

export type OfflineEventType = "RIDE_EN_ROUTE" | "ARRIVED_AT_PICKUP" | "RIDE_STARTED" | "RIDE_COMPLETED";
export type OfflineEvent = {
  eventId: string;
  rideId: string;
  type: OfflineEventType;
  timestamp: string;
  coordinates: { lat: number; lng: number } | null;
  retryCount: number;
  status: "pending" | "syncing" | "synced" | "failed";
};
export type SavedRoute = Pick<TrackingRoute, "phase" | "geometry" | "distanceMeters" | "durationSeconds" | "steps"> & { source: "online-osrm" | "offline-road-graph" };
export type OfflineRidePackage = {
  ride: Ride;
  driverId: string;
  createdAt: string;
  updatedAt: string;
  navigationState: string;
  routeToPickup: SavedRoute | null;
  routeToDestination: SavedRoute | null;
  mapRegionVersion: string;
  routingRegionVersion: string;
  mapReady: boolean;
  lastKnownPosition: { lat: number; lng: number; accuracy: number; timestamp: number } | null;
  offlineEvents: OfflineEvent[];
};

const DB_NAME = "moto-pombal-active-ride";
const STORE = "ride";
let writes: Promise<unknown> = Promise.resolve();

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read(): Promise<OfflineRidePackage | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get("active");
    request.onsuccess = () => resolve((request.result as OfflineRidePackage | undefined) || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
async function write(data: OfflineRidePackage | null): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    if (data) tx.objectStore(STORE).put(data, "active");
    else tx.objectStore(STORE).delete("active");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.catch(() => undefined);
  return next;
}

export function getOfflineRide(driverId?: string) {
  return serialize(async () => {
    const data = await read();
    return data && (!driverId || data.driverId === driverId) ? data : null;
  });
}

export function saveOfflineRide(data: OfflineRidePackage) {
  return serialize(() => write(data));
}

export function makeOfflineRide(ride: Ride, driverId: string, pickup: SavedRoute | null, trip: SavedRoute | null, mapReady: boolean): OfflineRidePackage {
  const now = new Date().toISOString();
  const safeRide: Ride = {
    id: ride.id, passenger_id: ride.passenger_id, driver_id: driverId,
    status: ride.status, origin_address: ride.origin_address, origin_lat: ride.origin_lat, origin_lng: ride.origin_lng,
    destination_address: ride.destination_address, destination_lat: ride.destination_lat, destination_lng: ride.destination_lng,
    distance_meters: ride.distance_meters, duration_seconds: ride.duration_seconds, route_geometry: ride.route_geometry,
    fare_cents: ride.fare_cents, payment_method: ride.payment_method, payment_status: ride.payment_status,
    fare_pricing_mode: ride.fare_pricing_mode,
    created_at: ride.created_at, requested_at: ride.requested_at, accepted_at: ride.accepted_at,
    arrived_at: ride.arrived_at, arrival_server_at: ride.arrival_server_at, started_at: ride.started_at,
    passenger: ride.passenger ? { full_name: ride.passenger.full_name, phone: ride.passenger.phone } : undefined,
  };
  return { ride: safeRide, driverId, createdAt: now, updatedAt: now, navigationState: ride.status,
    routeToPickup: pickup, routeToDestination: trip, mapRegionVersion: OFFLINE_REGION.version,
    routingRegionVersion: OFFLINE_REGION.version, mapReady, lastKnownPosition: null, offlineEvents: [] };
}

export function savedRoute(route: Pick<TrackingRoute, "phase" | "geometry" | "distanceMeters" | "durationSeconds" | "steps"> | LocalRoute | null): SavedRoute | null {
  if (!route) return null;
  return { phase: route.phase, geometry: route.geometry, distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds, steps: route.steps || [], source: "source" in route ? route.source : "online-osrm" };
}

export function updateOfflineRide(rideId: string, change: (data: OfflineRidePackage) => OfflineRidePackage) {
  return serialize(async () => {
    const data = await read();
    if (!data || data.ride.id !== rideId) return null;
    const updated = change(data);
    updated.updatedAt = new Date().toISOString();
    await write(updated);
    return updated;
  });
}

export function queueOfflineTransition(rideId: string, type: OfflineEventType, coordinates: OfflineEvent["coordinates"]) {
  return updateOfflineRide(rideId, (data) => {
    if (data.offlineEvents.some((event) => event.type === type)) return data;
    const status = type === "RIDE_EN_ROUTE" ? "motorista_a_caminho" : type === "ARRIVED_AT_PICKUP" ? "motorista_chegou" : type === "RIDE_STARTED" ? "em_corrida" : "finalizada";
    const event: OfflineEvent = { eventId: crypto.randomUUID(), rideId, type, timestamp: new Date().toISOString(), coordinates, retryCount: 0, status: "pending" };
    const timestamp = type === "ARRIVED_AT_PICKUP" ? { arrived_at: event.timestamp }
      : type === "RIDE_STARTED" ? { started_at: event.timestamp }
      : type === "RIDE_COMPLETED" ? { completed_at: event.timestamp } : {};
    return { ...data, navigationState: status, ride: { ...data.ride, status, ...timestamp }, offlineEvents: [...data.offlineEvents, event] };
  });
}

export function clearOfflineRide(rideId?: string) {
  return serialize(async () => {
    if (rideId && (await read())?.ride.id !== rideId) return;
    await write(null);
  });
}

export function markOfflineEvent(rideId: string, eventId: string, status: OfflineEvent["status"]) {
  return updateOfflineRide(rideId, (data) => ({ ...data, offlineEvents: data.offlineEvents.map((event) => event.eventId === eventId
    ? { ...event, status, retryCount: status === "failed" ? event.retryCount + 1 : event.retryCount }
    : event) }));
}
