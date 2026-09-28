import { ApiError } from "@/lib/backend/api";

const CITY = { lat: -10.8373, lng: -38.5357 };
const LOCAL_VIEWBOX = "-38.72,-10.69,-38.35,-10.99";
const headers = {
  "User-Agent": "MotoVIP/1.0 (Ribeira do Pombal passenger app)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

type NominatimResult = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  importance?: number;
  address?: Record<string, string | undefined>;
};

type PhotonFeature = {
  properties: { osm_id?: number; name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string; country?: string };
  geometry: { coordinates: [number, number] };
};

export type AddressResult = {
  id: string;
  address: string;
  shortAddress: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  approximate: boolean;
};

function cityName(address: NominatimResult["address"] = {}) {
  return address.city || address.town || address.municipality || address.village || address.county || "";
}

function roadName(address: NominatimResult["address"] = {}) {
  return address.road || address.pedestrian || address.residential || address.neighbourhood || address.suburb || "";
}

function toAddressResult(result: NominatimResult, approximate = false): AddressResult {
  const city = cityName(result.address);
  const road = roadName(result.address);
  const number = result.address?.house_number;
  const district = result.address?.suburb || result.address?.neighbourhood;
  const state = result.address?.state || "BA";
  const first = [road, number].filter(Boolean).join(", ") || result.display_name.split(",")[0];
  const shortAddress = [first, district, city && `${city}/${result.address?.state === "Bahia" ? "BA" : state}`]
    .filter(Boolean)
    .join(" — ");
  return {
    id: String(result.place_id),
    address: result.display_name,
    shortAddress,
    lat: Number(result.lat),
    lng: Number(result.lon),
    city,
    state,
    approximate,
  };
}

function localScore(result: NominatimResult) {
  const city = cityName(result.address).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const local = city.includes("ribeira do pombal") ? 100 : 0;
  const distance = Math.hypot(Number(result.lat) - CITY.lat, Number(result.lon) - CITY.lng);
  return local + (result.importance || 0) * 10 - distance;
}

function addressScore(result: AddressResult) {
  const city = result.city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const local = city.includes("ribeira do pombal") ? 100 : 0;
  return local - Math.hypot(result.lat - CITY.lat, result.lng - CITY.lng);
}

async function nominatimSearch(query: string, limit = 8) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "br",
    limit: String(limit),
    dedupe: "1",
    viewbox: LOCAL_VIEWBOX,
    bounded: "0",
    q: query,
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new ApiError(503, "A busca de endereços está temporariamente indisponível.", "GEOCODING_UNAVAILABLE");
  return await response.json() as NominatimResult[];
}

async function photonSearch(query: string) {
  const params = new URLSearchParams({ q: query, lat: String(CITY.lat), lon: String(CITY.lng), limit: "8" });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { headers, cache: "no-store", signal: AbortSignal.timeout(9000) });
  if (!response.ok) return [] as AddressResult[];
  const payload = await response.json() as { features?: PhotonFeature[] };
  return (payload.features || []).map((feature, index) => {
    const p = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    const first = [p.street || p.name, p.housenumber].filter(Boolean).join(", ");
    const address = [first, p.district, p.city, p.state, p.country].filter(Boolean).join(", ");
    return {
      id: `photon-${p.osm_id || index}-${index}`,
      address,
      shortAddress: [first, p.district, p.city && `${p.city}/${p.state === "Bahia" ? "BA" : p.state || ""}`].filter(Boolean).join(" — "),
      lat,
      lng,
      city: p.city || "",
      state: p.state || "",
      approximate: false,
    } satisfies AddressResult;
  });
}

export async function searchAddresses(rawQuery: string) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  const localQuery = `${query}, Ribeira do Pombal, Bahia, Brasil`;
  const [localResults, autocomplete] = await Promise.all([nominatimSearch(localQuery), photonSearch(query)]);
  let results = localResults;
  let approximate = false;

  const numberMatch = query.match(/^(.*?)(?:,|\s)\s*(\d+[A-Za-z]?)\s*$/);
  const hasExactNumber = numberMatch ? results.some((item) => item.address?.house_number?.toLowerCase() === numberMatch[2].toLowerCase()) : true;
  if ((!results.length || !hasExactNumber) && numberMatch?.[1]) {
    results = await nominatimSearch(`${numberMatch[1].trim()}, Ribeira do Pombal, Bahia, Brasil`);
    approximate = results.length > 0;
  }
  const mapped = results
    .sort((a, b) => localScore(b) - localScore(a))
    .map((item) => toAddressResult(item, approximate || Boolean(numberMatch && item.address?.house_number?.toLowerCase() !== numberMatch[2].toLowerCase())));
  mapped.push(...autocomplete.map((item) => ({ ...item, approximate: item.approximate || Boolean(numberMatch && !item.address.includes(numberMatch[2])) })));
  if (mapped.length < 3) {
    const broader = await nominatimSearch(query);
    mapped.push(...broader.map((item) => toAddressResult(item, Boolean(numberMatch && item.address?.house_number?.toLowerCase() !== numberMatch[2].toLowerCase()))));
  }
  const seen = new Set<string>();
  return mapped
    .sort((a, b) => addressScore(b) - addressScore(a))
    .filter((item) => {
      const key = item.shortAddress.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export async function reverseAddress(lat: number, lng: number) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
    lat: String(lat),
    lon: String(lng),
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new ApiError(503, "Não foi possível converter a localização em endereço.", "REVERSE_GEOCODING_UNAVAILABLE");
  const result = await response.json() as NominatimResult & { error?: string };
  if (result.error || !result.display_name) {
    return {
      id: `coords-${lat}-${lng}`,
      address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      shortAddress: "Ponto selecionado no mapa",
      lat,
      lng,
      city: "",
      state: "",
      approximate: true,
    } satisfies AddressResult;
  }
  return toAddressResult(result);
}
