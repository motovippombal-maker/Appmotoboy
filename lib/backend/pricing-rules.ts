export type Coordinates = {
  lat: number;
  lng: number;
};

type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

export type GeoBoundary = GeoJsonPolygon | GeoJsonMultiPolygon;

export type ServiceAreaRule = {
  id: string;
  name: string;
  boundary: unknown;
  active: boolean;
  allow_origins: boolean;
  allow_destinations: boolean;
  priority: number;
  updated_at: string;
};

export type FareRegionRule = {
  id: string;
  name: string;
  amount_cents: number;
  active: boolean;
  is_default: boolean;
  boundary: unknown | null;
  priority: number;
  updated_at: string;
};

export type ResolvedFareRule = {
  fareCents: number;
  fareRegion: {
    id: string;
    name: string;
    isDefault: boolean;
    priority: number;
  };
  serviceArea: {
    id: string;
    name: string;
  };
  snapshot: {
    regionId: string;
    regionName: string;
    amountCents: number;
    isDefault: boolean;
    regionPriority: number;
    regionUpdatedAt: string;
    originServiceAreaId: string;
    originServiceAreaName: string;
    originServiceAreaUpdatedAt: string;
    serviceAreaId: string;
    serviceAreaName: string;
    serviceAreaUpdatedAt: string;
    resolution: "special_region" | "default_within_service_area";
  };
};

export class PricingRuleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertValidCoordinates(point: Coordinates) {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    throw new PricingRuleError(
      "INVALID_COORDINATES",
      "As coordenadas informadas são inválidas.",
    );
  }
}

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function isRing(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}

function parseBoundary(value: unknown): GeoBoundary | null {
  if (!value || typeof value !== "object" || !("type" in value) || !("coordinates" in value)) return null;
  const candidate = value as { type: unknown; coordinates: unknown };
  if (
    candidate.type === "Polygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(isRing)
  ) {
    return candidate as GeoJsonPolygon;
  }
  if (
    candidate.type === "MultiPolygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(
      (polygon) =>
        Array.isArray(polygon) && polygon.length > 0 && polygon.every(isRing),
    )
  ) {
    return candidate as GeoJsonMultiPolygon;
  }
  return null;
}

function pointOnSegment(
  point: Coordinates,
  first: [number, number],
  second: [number, number],
) {
  const cross =
    (point.lat - first[1]) * (second[0] - first[0]) -
    (point.lng - first[0]) * (second[1] - first[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    point.lng >= Math.min(first[0], second[0]) - 1e-10 &&
    point.lng <= Math.max(first[0], second[0]) + 1e-10 &&
    point.lat >= Math.min(first[1], second[1]) - 1e-10 &&
    point.lat <= Math.max(first[1], second[1]) + 1e-10
  );
}

function pointInRing(point: Coordinates, ring: Array<[number, number]>) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const intersects =
      currentPoint[1] > point.lat !== previousPoint[1] > point.lat &&
      point.lng <
        ((previousPoint[0] - currentPoint[0]) *
          (point.lat - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Coordinates, polygon: number[][][]) {
  const [outer, ...holes] = polygon as Array<Array<[number, number]>>;
  return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
}

export function boundaryContains(boundaryValue: unknown, point: Coordinates) {
  assertValidCoordinates(point);
  const boundary = parseBoundary(boundaryValue);
  if (!boundary) return false;
  if (boundary.type === "Polygon") return pointInPolygon(point, boundary.coordinates);
  return boundary.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

function deterministicRuleOrder<T extends { priority: number; name: string; id: string }>(
  first: T,
  second: T,
) {
  return (
    second.priority - first.priority ||
    (first.name === second.name ? 0 : first.name < second.name ? -1 : 1) ||
    (first.id === second.id ? 0 : first.id < second.id ? -1 : 1)
  );
}

function containingServiceArea(
  areas: ServiceAreaRule[],
  point: Coordinates,
  permission: "allow_origins" | "allow_destinations",
) {
  return areas
    .filter(
      (area) =>
        area.active && area[permission] && boundaryContains(area.boundary, point),
    )
    .sort(deterministicRuleOrder)[0];
}

export function resolveFareRule(input: {
  origin: Coordinates;
  destination: Coordinates;
  serviceAreas: ServiceAreaRule[];
  fareRegions: FareRegionRule[];
}): ResolvedFareRule {
  assertValidCoordinates(input.origin);
  assertValidCoordinates(input.destination);

  const activeAreas = input.serviceAreas.filter((area) => area.active);
  if (!activeAreas.length) {
    throw new PricingRuleError(
      "SERVICE_AREA_NOT_CONFIGURED",
      "A área de atendimento ainda não foi configurada.",
    );
  }
  if (activeAreas.some((area) => !parseBoundary(area.boundary))) {
    throw new PricingRuleError(
      "INVALID_SERVICE_AREA_CONFIGURATION",
      "A configuração da área de atendimento é inválida.",
    );
  }

  const originArea = containingServiceArea(
    activeAreas,
    input.origin,
    "allow_origins",
  );
  if (!originArea) {
    throw new PricingRuleError(
      "ORIGIN_OUTSIDE_SERVICE_AREA",
      "A origem está fora da área de atendimento.",
    );
  }
  const destinationArea = containingServiceArea(
    activeAreas,
    input.destination,
    "allow_destinations",
  );
  if (!destinationArea) {
    throw new PricingRuleError(
      "DESTINATION_OUTSIDE_SERVICE_AREA",
      "O destino está fora da área de atendimento.",
    );
  }

  const activeRegions = input.fareRegions.filter((region) => region.active);
  const fallback = activeRegions.find((region) => region.is_default);
  if (!fallback) {
    throw new PricingRuleError(
      "DEFAULT_REGION_FARE_MISSING",
      "A tarifa padrão da cidade não está ativa.",
    );
  }

  const configuredSpecialRegions = activeRegions.filter(
    (region) => !region.is_default && region.boundary !== null,
  );
  if (configuredSpecialRegions.some((region) => !parseBoundary(region.boundary))) {
    throw new PricingRuleError(
      "INVALID_FARE_REGION_CONFIGURATION",
      "A configuração geográfica de uma tarifa regional é inválida.",
    );
  }
  const matched = configuredSpecialRegions
    .filter((region) => boundaryContains(region.boundary, input.destination))
    .sort(deterministicRuleOrder)[0];
  const selected = matched || fallback;

  return {
    fareCents: selected.amount_cents,
    fareRegion: {
      id: selected.id,
      name: selected.name,
      isDefault: selected.is_default,
      priority: selected.priority,
    },
    serviceArea: { id: destinationArea.id, name: destinationArea.name },
    snapshot: {
      regionId: selected.id,
      regionName: selected.name,
      amountCents: selected.amount_cents,
      isDefault: selected.is_default,
      regionPriority: selected.priority,
      regionUpdatedAt: selected.updated_at,
      originServiceAreaId: originArea.id,
      originServiceAreaName: originArea.name,
      originServiceAreaUpdatedAt: originArea.updated_at,
      serviceAreaId: destinationArea.id,
      serviceAreaName: destinationArea.name,
      serviceAreaUpdatedAt: destinationArea.updated_at,
      resolution: matched ? "special_region" : "default_within_service_area",
    },
  };
}
