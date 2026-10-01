import fs from "node:fs/promises";
import path from "node:path";

// Run only when updating the local region package. Never prefetch raster tiles.
const output = path.join(process.cwd(), "public/offline/ribeira-do-pombal-ba-2026-10-01-1.json");
const bounds = [-10.89, -38.61, -10.78, -38.46];
const response = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bounds[1]},${bounds[0]},${bounds[3]},${bounds[2]}`, {
  headers: { "user-agent": "MotoPombal/1.0 (offline street extract)" },
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok) throw new Error(`OpenStreetMap API HTTP ${response.status}`);
const raw = await response.json();
const nodes = new Map(raw.elements.filter((item) => item.type === "node").map((item) => [item.id, [Number(item.lat.toFixed(6)), Number(item.lon.toFixed(6))]]));
const allowedHighways = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]);
const roads = raw.elements.filter((item) => item.type === "way" && item.nodes?.length > 1 && allowedHighways.has(item.tags?.highway) &&
    !["no", "private"].includes(item.tags?.access) &&
    !["no", "private"].includes(item.tags?.motor_vehicle) &&
    !["no", "private"].includes(item.tags?.motorcycle))
  .map((way) => ({
    id: way.id,
    name: way.tags?.name || way.tags?.ref || "",
    highway: way.tags?.highway,
    oneway: way.tags?.oneway === "yes" || way.tags?.junction === "roundabout" ? 1 : way.tags?.oneway === "-1" ? -1 : 0,
    nodes: way.nodes.filter((id) => nodes.has(id)),
  })).filter((way) => way.nodes.length > 1 && way.highway);
const usedNodes = new Map();
for (const road of roads) for (const id of road.nodes) usedNodes.set(id, nodes.get(id));
const places = raw.elements.filter((item) => item.type === "node" && item.tags?.name &&
  ["city", "town", "suburb", "neighbourhood", "quarter", "village"].includes(item.tags?.place))
  .map((item) => ({ name: item.tags.name, lat: Number(item.lat.toFixed(6)), lng: Number(item.lon.toFixed(6)), kind: item.tags.place }));
const packageData = {
  regionId: "ribeira-do-pombal-ba",
  version: "2026-10-01-1",
  bounds,
  source: "© OpenStreetMap contributors; ODbL 1.0; https://www.openstreetmap.org/copyright",
  generatedAt: new Date().toISOString(),
  nodes: Object.fromEntries(usedNodes),
  roads,
  places,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(packageData));
console.log(`Wrote ${roads.length} roads, ${usedNodes.size} nodes, ${places.length} places, ${Math.round((await fs.stat(output)).size / 1024)} KiB`);
