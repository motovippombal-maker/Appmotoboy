import type { Ride } from "@/hooks/use-moto-vip";
import type { OfflineRidePackage } from "@/lib/offline/ride-store";

export function selectDriverRide(input: {
  serverRide: Ride | null;
  offlinePackage: OfflineRidePackage | null;
  cancelledRideId?: string | null;
  serverVerified: boolean;
  serverReachable: boolean;
}): Ride | null {
  const { serverRide, offlinePackage, cancelledRideId, serverVerified, serverReachable } = input;
  if (offlinePackage && cancelledRideId === offlinePackage.ride.id) return null;
  if (serverReachable && !serverVerified) return serverRide;
  if (serverReachable && serverVerified) return serverRide;
  if (offlinePackage?.offlineEvents.some((event) => event.status !== "synced") &&
      (!serverRide || serverRide.id === offlinePackage.ride.id)) {
    return { ...(serverRide || offlinePackage.ride), status: offlinePackage.navigationState };
  }
  return serverRide || (offlinePackage?.navigationState !== "finalizada" ? offlinePackage?.ride || null : null);
}
