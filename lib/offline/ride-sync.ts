import type { Ride } from "@/hooks/use-moto-vip";
import { clearOfflineRide, getOfflineRide, markOfflineEvent, type OfflineEvent, type OfflineRidePackage } from "@/lib/offline/ride-store";

const STATUS_ORDER = ["aceita", "motorista_a_caminho", "motorista_chegou", "em_corrida", "finalizada"];
const eventStatus: Record<OfflineEvent["type"], string> = {
  RIDE_EN_ROUTE: "motorista_a_caminho", ARRIVED_AT_PICKUP: "motorista_chegou", RIDE_STARTED: "em_corrida", RIDE_COMPLETED: "finalizada",
};
export type SyncApi = {
  getSnapshot: () => Promise<{ ride: Ride | null; completedRide: Ride | null; cancelledRide?: { id: string } | null }>;
  transition: (rideId: string, status: string, event: OfflineEvent) => Promise<unknown>;
};
export type SyncStore = {
  get: (driverId: string) => Promise<OfflineRidePackage | null>;
  mark: (rideId: string, eventId: string, status: OfflineEvent["status"]) => Promise<unknown>;
  clear: (rideId: string) => Promise<unknown>;
};
const defaultStore: SyncStore = { get: getOfflineRide, mark: markOfflineEvent, clear: clearOfflineRide };

export async function syncOfflineRide(driverId: string, api: SyncApi, store: SyncStore = defaultStore) {
  const initial = await store.get(driverId);
  if (!initial) return { confirmed: 0, pending: 0, conflict: null as string | null };
  let confirmed = 0;
  for (const event of initial.offlineEvents.filter((item) => item.status !== "synced")) {
    const snapshot = await api.getSnapshot();
    if (snapshot.cancelledRide?.id === initial.ride.id) {
      await store.clear(initial.ride.id);
      return { confirmed, pending: 0, conflict: null as string | null, cancelled: true };
    }
    const server = snapshot.ride?.id === initial.ride.id ? snapshot.ride
      : snapshot.completedRide?.id === initial.ride.id ? snapshot.completedRide : null;
    if (!server || server.driver_id !== driverId) return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: "A corrida não foi encontrada na conta deste motorista. Sincronização interrompida." };
    if (server.status === "cancelada") {
      await store.clear(initial.ride.id);
      return { confirmed, pending: 0, conflict: null as string | null, cancelled: true };
    }
    const desired = eventStatus[event.type];
    const serverIndex = STATUS_ORDER.indexOf(server.status);
    const desiredIndex = STATUS_ORDER.indexOf(desired);
    if (serverIndex < 0) return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: "Estado inesperado da corrida no servidor." };
    if (serverIndex < desiredIndex) {
      if (serverIndex !== desiredIndex - 1) return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: "Etapas anteriores ainda não foram confirmadas." };
      if (event.type === "RIDE_COMPLETED" && server.fare_pricing_mode !== "region")
        return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: "Esta corrida usa tarifa variável. A central precisa conferir a distância antes da finalização no servidor." };
      try { await api.transition(initial.ride.id, desired, event); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (["INVALID_OFFLINE_TIMESTAMP", "OFFLINE_FARE_REVIEW_REQUIRED", "INVALID_RIDE_TRANSITION", "CANCELLATION_NOT_ALLOWED"].includes(code))
          return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: error instanceof Error ? error.message : "A central precisa revisar esta corrida." };
        await store.mark(initial.ride.id, event.eventId, "failed");
        return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: null };
      }
      const after = await api.getSnapshot();
      const confirmedRide = after.ride?.id === initial.ride.id ? after.ride
        : after.completedRide?.id === initial.ride.id ? after.completedRide : null;
      if (!confirmedRide || STATUS_ORDER.indexOf(confirmedRide.status) < desiredIndex)
        return { confirmed, pending: initial.offlineEvents.length - confirmed, conflict: null };
    }
    await store.mark(initial.ride.id, event.eventId, "synced");
    confirmed += 1;
  }
  const current = await store.get(driverId);
  const pending = current?.offlineEvents.filter((event) => event.status !== "synced").length || 0;
  if (!pending && current?.navigationState === "finalizada") await store.clear(current.ride.id);
  return { confirmed, pending, conflict: null as string | null };
}
