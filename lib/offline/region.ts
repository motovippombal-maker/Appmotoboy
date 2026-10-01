export type OfflineRegion = {
  id: string;
  name: string;
  version: string;
  bounds: [south: number, west: number, north: number, east: number];
  packageUrl: string;
  checksumSha256: string;
};

// A package is generated from OpenStreetMap road data by scripts/build-offline-region.mjs.
// Other service areas can supply their own manifest and package without changing navigation.
export const OFFLINE_REGION: OfflineRegion = {
  id: "ribeira-do-pombal-ba",
  name: "Ribeira do Pombal e entorno",
  version: "2026-10-01-1",
  bounds: [-10.89, -38.61, -10.78, -38.46],
  packageUrl: "/offline/ribeira-do-pombal-ba-2026-10-01-1.json",
  checksumSha256: "2aa1a2995ba11b295071f285dc3039f535ab24b524dc559512ccd11f684d0dd5",
};

export function isInsideRegion(lat: number, lng: number, region = OFFLINE_REGION) {
  const [south, west, north, east] = region.bounds;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}
