import { OFFLINE_REGION } from "@/lib/offline/region";
import { RoadGraph, type RoadPackage } from "@/lib/offline/road-graph";

const CACHE_NAME = "moto-pombal-region-packages";
let loaded: Promise<RoadGraph> | null = null;

async function verify(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === OFFLINE_REGION.checksumSha256;
}

async function parse(response: Response): Promise<RoadGraph> {
  if (!response.ok) throw new Error("Pacote regional indisponível.");
  const bytes = await response.arrayBuffer();
  if (!(await verify(bytes))) throw new Error("Pacote regional não passou na verificação de integridade.");
  const data = JSON.parse(new TextDecoder().decode(bytes)) as RoadPackage;
  if (data.regionId !== OFFLINE_REGION.id || data.version !== OFFLINE_REGION.version || !data.nodes || !Array.isArray(data.roads))
    throw new Error("Versão do mapa offline incompatível.");
  return new RoadGraph(data);
}

export async function loadRegionPackage(): Promise<RoadGraph> {
  if (loaded) return loaded;
  loaded = (async () => {
    // A blocked/full Cache Storage must not prevent the online map package from loading.
    const cache = await caches.open(CACHE_NAME).catch(() => null);
    const cached = await cache?.match(OFFLINE_REGION.packageUrl).catch(() => null);
    if (cached) {
      try { return await parse(cached); } catch { await cache?.delete(OFFLINE_REGION.packageUrl).catch(() => undefined); }
    }
    const response = await fetch(OFFLINE_REGION.packageUrl, { cache: "no-cache" });
    const graph = await parse(response.clone());
    await cache?.put(OFFLINE_REGION.packageUrl, response).catch(() => undefined);
    return graph;
  })().catch((error) => { loaded = null; throw error; });
  return loaded;
}

export async function regionPackageReady() {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(OFFLINE_REGION.packageUrl);
  if (!response) return false;
  try { await parse(response); return true; } catch { return false; }
}
