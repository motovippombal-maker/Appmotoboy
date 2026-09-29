import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";
import {
  PricingRuleError,
  resolveFareRule,
  type Coordinates,
  type FareRegionRule,
  type ServiceAreaRule,
} from "@/lib/backend/pricing-rules";

type NominatimAddress = Record<string, string | undefined>;

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

export async function resolveTripFare(
  supabase: SupabaseClient,
  origin: Coordinates,
  destination: Coordinates,
) {
  const [areasResult, regionsResult] = await Promise.all([
    supabase
      .from("service_areas")
      .select(
        "id,name,boundary,active,allow_origins,allow_destinations,priority,updated_at",
      )
      .eq("active", true),
    supabase
      .from("fare_regions")
      .select(
        "id,name,amount_cents,active,is_default,boundary,priority,updated_at",
      )
      .eq("active", true),
  ]);
  if (areasResult.error) throw areasResult.error;
  if (regionsResult.error) throw regionsResult.error;

  try {
    return resolveFareRule({
      origin,
      destination,
      serviceAreas: (areasResult.data || []) as ServiceAreaRule[],
      fareRegions: (regionsResult.data || []) as FareRegionRule[],
    });
  } catch (error) {
    if (!(error instanceof PricingRuleError)) throw error;
    const status = error.code.endsWith("NOT_CONFIGURED") || error.code.includes("CONFIGURATION") || error.code.endsWith("MISSING")
      ? 503
      : error.code === "INVALID_COORDINATES"
        ? 400
        : 422;
    throw new ApiError(status, error.message, error.code);
  }
}
