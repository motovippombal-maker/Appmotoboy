import { ApiError } from "@/lib/backend/errors";
import {
  isValidCoordinates,
  preserveExactCoordinates,
  type ExactCoordinates,
} from "@/lib/location/coordinates";

const CITY = { lat: -10.8373, lng: -38.5357 };
const LOCAL_VIEWBOX = "-38.72,-10.69,-38.35,-10.99";
const headers = {
  "User-Agent": "MotoVIP/1.0 (Ribeira do Pombal passenger app)",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const searchCache = new Map<
  string,
  { expiresAt: number; results: AddressResult[] }
>();
let nominatimQueue: Promise<void> = Promise.resolve();
let nextNominatimRequestAt = 0;

type NominatimResult = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string | undefined>;
};

type PhotonFeature = {
  properties: {
    osm_id?: number;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  geometry: { coordinates: [number, number] };
};

export type AddressProviderId = "nominatim" | "photon" | "coordinates";

export type AddressResult = {
  id: string;
  address: string;
  shortAddress: string;
  lat: number;
  lng: number;
  district: string;
  city: string;
  state: string;
  approximate: boolean;
  provider: AddressProviderId;
};

export type AddressQuery = {
  raw: string;
  normalized: string;
  street: string;
  number: string | null;
};

export interface AddressSearchProvider {
  id: AddressProviderId;
  search(query: AddressQuery): Promise<AddressResult[]>;
  reverse?(point: ExactCoordinates): Promise<AddressResult>;
  details?(id: string): Promise<AddressResult | null>;
}

export function parseAddressQuery(rawQuery: string): AddressQuery {
  const normalized = rawQuery.trim().replace(/\s+/g, " ");
  const numberMatch = normalized.match(/^(.*?)(?:,|\s)\s*(\d+[A-Za-z]?)\s*$/);
  return {
    raw: rawQuery,
    normalized,
    street: numberMatch?.[1]?.trim() || normalized,
    number: numberMatch?.[2] || null,
  };
}

function cityName(address: NominatimResult["address"] = {}) {
  return (
    address.city ||
    address.town ||
    address.municipality ||
    address.village ||
    address.county ||
    ""
  );
}

function roadName(address: NominatimResult["address"] = {}) {
  return (
    address.road ||
    address.pedestrian ||
    address.residential ||
    address.neighbourhood ||
    address.suburb ||
    ""
  );
}

function toNominatimResult(
  result: NominatimResult,
  requestedNumber: string | null,
  approximate = false,
): AddressResult | null {
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  if (!isValidCoordinates({ lat, lng })) return null;
  const city = cityName(result.address);
  const road = roadName(result.address);
  const number = result.address?.house_number;
  const district = result.address?.suburb || result.address?.neighbourhood || "";
  const state = result.address?.state || "";
  const first =
    [road, number].filter(Boolean).join(", ") ||
    result.display_name.split(",")[0];
  const exactNumber =
    !requestedNumber || number?.toLowerCase() === requestedNumber.toLowerCase();
  return {
    id: `nominatim-${result.place_id}`,
    address: result.display_name,
    shortAddress: [
      first,
      district,
      city && `${city}/${state === "Bahia" ? "BA" : state}`,
    ]
      .filter(Boolean)
      .join(" — "),
    lat,
    lng,
    district,
    city,
    state,
    approximate: approximate || !exactNumber,
    provider: "nominatim",
  };
}

function toPhotonResult(
  feature: PhotonFeature,
  index: number,
  requestedNumber: string | null,
): AddressResult | null {
  const properties = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  if (!isValidCoordinates({ lat, lng })) return null;
  const first = [properties.street || properties.name, properties.housenumber]
    .filter(Boolean)
    .join(", ");
  const address = [
    first,
    properties.district,
    properties.city,
    properties.state,
    properties.country,
  ]
    .filter(Boolean)
    .join(", ");
  const exactNumber =
    !requestedNumber ||
    properties.housenumber?.toLowerCase() === requestedNumber.toLowerCase();
  return {
    id: `photon-${properties.osm_id || index}-${index}`,
    address,
    shortAddress: [
      first,
      properties.district,
      properties.city &&
        `${properties.city}/${properties.state === "Bahia" ? "BA" : properties.state || ""}`,
    ]
      .filter(Boolean)
      .join(" — "),
    lat,
    lng,
    district: properties.district || "",
    city: properties.city || "",
    state: properties.state || "",
    approximate: !exactNumber,
    provider: "photon",
  };
}

function localScore(result: AddressResult) {
  const city = result.city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const local = city.includes("ribeira do pombal") ? 100 : 0;
  return local - Math.hypot(result.lat - CITY.lat, result.lng - CITY.lng);
}

async function fetchNominatim(query: string, limit = 8) {
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
  const response = await fetchNominatimUrl(
    `https://nominatim.openstreetmap.org/search?${params}`,
  );
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  return (await response.json()) as NominatimResult[];
}

async function fetchNominatimUrl(url: string) {
  let release: () => void = () => undefined;
  const previous = nominatimQueue;
  nominatimQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const delay = Math.max(0, nextNominatimRequestAt - Date.now());
  if (delay) {
    await new Promise<void>((resolve) => windowlessTimeout(resolve, delay));
  }
  nextNominatimRequestAt = Date.now() + 1100;
  try {
    return await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
  } finally {
    release();
  }
}

function windowlessTimeout(resolve: () => void, delay: number) {
  return setTimeout(resolve, delay);
}

const nominatimProvider: AddressSearchProvider = {
  id: "nominatim",
  async search(query) {
    let rawResults = await fetchNominatim(
      `${query.normalized}, Ribeira do Pombal, Bahia, Brasil`,
    );
    let approximate = false;
    if (
      query.number &&
      !rawResults.some(
        (item) =>
          item.address?.house_number?.toLowerCase() ===
          query.number?.toLowerCase(),
      )
    ) {
      const initialResults = rawResults;
      try {
        rawResults = await fetchNominatim(
          `${query.street}, Ribeira do Pombal, Bahia, Brasil`,
        );
        approximate = rawResults.length > 0;
      } catch {
        rawResults = initialResults;
        approximate = rawResults.length > 0;
      }
    }
    return rawResults
      .map((item) => toNominatimResult(item, query.number, approximate))
      .filter((item): item is AddressResult => Boolean(item));
  },
  async reverse(point) {
    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      zoom: "18",
      lat: String(point.lat),
      lon: String(point.lng),
    });
    const response = await fetchNominatimUrl(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
    );
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const result = (await response.json()) as NominatimResult & {
      error?: string;
    };
    const normalized =
      !result.error && result.display_name
        ? toNominatimResult(result, null)
        : null;
    if (!normalized) {
      return {
        id: `coords-${point.lat}-${point.lng}`,
        address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
        shortAddress: "Ponto selecionado no mapa",
        lat: point.lat,
        lng: point.lng,
        district: "",
        city: "",
        state: "",
        approximate: true,
        provider: "coordinates",
      };
    }
    return preserveExactCoordinates(point, normalized);
  },
};

const photonProvider: AddressSearchProvider = {
  id: "photon",
  async search(query) {
    const params = new URLSearchParams({
      q: query.normalized,
      lat: String(CITY.lat),
      lon: String(CITY.lng),
      limit: "8",
    });
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
    const payload = (await response.json()) as { features?: PhotonFeature[] };
    return (payload.features || [])
      .map((feature, index) => toPhotonResult(feature, index, query.number))
      .filter((item): item is AddressResult => Boolean(item));
  },
};

export async function searchWithProviders(
  query: AddressQuery,
  providers: AddressSearchProvider[],
) {
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.search(query)),
  );
  const successful = settled.filter(
    (result): result is PromiseFulfilledResult<AddressResult[]> =>
      result.status === "fulfilled",
  );
  if (!successful.length) {
    throw new ApiError(
      503,
      "A busca de endereços está temporariamente indisponível.",
      "GEOCODING_UNAVAILABLE",
    );
  }
  return successful.flatMap((result) => result.value);
}

export async function searchAddresses(rawQuery: string) {
  const query = parseAddressQuery(rawQuery);
  const cacheKey = query.normalized.toLocaleLowerCase("pt-BR");
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const combined = await searchWithProviders(query, [
    photonProvider,
    nominatimProvider,
  ]);
  const seen = new Set<string>();
  const results = combined
    .sort((first, second) => localScore(second) - localScore(first))
    .filter((item) => {
      const key = `${item.shortAddress}|${item.lat.toFixed(6)}|${item.lng.toFixed(6)}`.toLocaleLowerCase("pt-BR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  searchCache.set(cacheKey, {
    expiresAt: Date.now() + 2 * 60 * 1000,
    results,
  });
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  return results;
}

export async function reverseAddress(lat: number, lng: number) {
  const point = { lat, lng };
  if (!isValidCoordinates(point)) {
    throw new ApiError(
      400,
      "As coordenadas informadas são inválidas.",
      "INVALID_COORDINATES",
    );
  }
  try {
    return await nominatimProvider.reverse!(point);
  } catch {
    throw new ApiError(
      503,
      "Não foi possível identificar o endereço. O ponto selecionado foi preservado.",
      "REVERSE_GEOCODING_UNAVAILABLE",
    );
  }
}
