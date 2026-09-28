import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";

export type FareRegion = {
  id: string;
  name: string;
  amount_cents: number;
  active: boolean;
  is_default: boolean;
};

type NominatimAddress = Record<string, string | undefined>;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

export function regionLabels(address: NominatimAddress = {}) {
  return [address.neighbourhood, address.suburb, address.quarter, address.city_district, address.village, address.town, address.hamlet]
    .filter((value): value is string => Boolean(value));
}

export async function reverseDestination(lat: number, lng: number) {
  const query = new URLSearchParams({ format: "jsonv2", addressdetails: "1", lat: String(lat), lon: String(lng) });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query}`, {
    headers: { "User-Agent": "MotoVIP/1.0", "Accept-Language": "pt-BR" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new ApiError(503, "Não foi possível confirmar a região do destino.", "REGION_LOOKUP_UNAVAILABLE");
  const result = await response.json() as { display_name?: string; address?: NominatimAddress; error?: string };
  if (result.error || !result.display_name) throw new ApiError(422, "Não foi possível identificar a região do destino.", "REGION_NOT_FOUND");
  return { displayName: result.display_name, labels: regionLabels(result.address) };
}

export async function resolveRegionFare(supabase: SupabaseClient, address: string, labels: string[] = []) {
  const { data, error } = await supabase.from("fare_regions").select("id,name,amount_cents,active,is_default").eq("active", true);
  if (error) throw error;
  const regions = (data || []) as FareRegion[];
  const fallback = regions.find((region) => region.is_default);
  if (!fallback) throw new ApiError(503, "A tarifa padrão da cidade não está ativa.", "DEFAULT_REGION_FARE_MISSING");

  const candidates = [address, ...labels].map(normalize).filter(Boolean);
  const matched = regions
    .filter((region) => !region.is_default)
    .sort((a, b) => normalize(b.name).length - normalize(a.name).length)
    .find((region) => candidates.some((candidate) => candidate.includes(normalize(region.name))));
  const selected = matched || fallback;
  return {
    fareCents: selected.amount_cents,
    fareRegion: { id: selected.id, name: selected.name, isDefault: selected.is_default },
    snapshot: { regionId: selected.id, regionName: selected.name, amountCents: selected.amount_cents, isDefault: selected.is_default },
  };
}
