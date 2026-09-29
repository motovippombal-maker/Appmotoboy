import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";
import { distanceKm, type Coordinate } from "@/lib/backend/routing";

type DispatchSettings = {
  offerSeconds: number;
  radiusKm: number;
  maxRadiusKm: number;
  freshnessSeconds: number;
};

export type NearbyDriver = {
  driverId: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  updatedAt: string;
};

export async function getDispatchSettings(supabase: SupabaseClient): Promise<DispatchSettings> {
  const { data, error } = await supabase.from("system_settings").select("key,value").in("key", ["dispatch", "tracking"]);
  if (error) throw new ApiError(503, "Configuração de despacho indisponível.", "DISPATCH_UNAVAILABLE");
  const settings = Object.fromEntries((data || []).map((row) => [row.key, row.value])) as Record<string, Record<string, number>>;
  const dispatch = settings.dispatch || {};
  const tracking = settings.tracking || {};
  const maxRadiusKm = Math.min(20, Math.max(1, Number(dispatch.max_radius_km) || 10));
  return {
    offerSeconds: Math.min(90, Math.max(15, Number(dispatch.offer_seconds) || 20)),
    radiusKm: Math.min(maxRadiusKm, Math.max(1, Number(dispatch.initial_radius_km) || 3)),
    maxRadiusKm,
    freshnessSeconds: Math.min(180, Math.max(30, (Number(tracking.available_interval_seconds) || 20) * 3)),
  };
}

export async function findNearbyDrivers(supabase: SupabaseClient, origin: Coordinate) {
  const config = await getDispatchSettings(supabase);
  const freshness = new Date(Date.now() - config.freshnessSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from("driver_locations")
    .select("driver_id,latitude,longitude,updated_at,drivers!inner(approval_status,online,available)")
    .gte("updated_at", freshness)
    .eq("drivers.approval_status", "approved")
    .eq("drivers.online", true)
    .eq("drivers.available", true)
    .limit(100);
  if (error) throw new ApiError(503, "Não foi possível localizar motoristas agora.", "DRIVER_SEARCH_UNAVAILABLE");

  const drivers = (data || [])
    .map((row) => ({
      driverId: row.driver_id,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceKm: distanceKm(origin, { lat: row.latitude, lng: row.longitude }),
      updatedAt: row.updated_at,
    }))
    .filter((driver) => driver.distanceKm <= config.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 20) as NearbyDriver[];

  return { drivers, config };
}

export async function assertFreshDriverLocation(supabase: SupabaseClient, driverId: string) {
  const config = await getDispatchSettings(supabase);
  const freshness = new Date(Date.now() - config.freshnessSeconds * 1000).toISOString();
  const { data } = await supabase.from("driver_locations").select("updated_at").eq("driver_id", driverId).gte("updated_at", freshness).maybeSingle();
  if (!data) throw new ApiError(409, "Sua localização está desatualizada. Aguarde um novo sinal de GPS.", "STALE_DRIVER_LOCATION");
}

export async function expireRideSearches(supabase: SupabaseClient, rideId?: string) {
  const { error } = await supabase.rpc("expire_ride_searches", {
    p_ride_id: rideId || null,
  });
  if (error) throw new ApiError(503, "Não foi possível atualizar as ofertas agora.", "OFFER_EXPIRATION_UNAVAILABLE");
}
