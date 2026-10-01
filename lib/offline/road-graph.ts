import { metersBetween, type NavPoint } from "@/lib/navigation/driver-navigation";

export type OfflineRoad = { id: number; name: string; highway: string; oneway: -1 | 0 | 1; nodes: number[] };
export type RoadPackage = {
  regionId: string;
  version: string;
  bounds: [number, number, number, number];
  source: string;
  generatedAt: string;
  nodes: Record<string, [lat: number, lng: number]>;
  roads: OfflineRoad[];
  places?: Array<{ name: string; lat: number; lng: number; kind: string }>;
};
export type LocalRoute = {
  phase: "pickup" | "trip";
  geometry: string;
  distanceMeters: number;
  durationSeconds: number;
  steps: Array<{ distanceMeters: number; location: [number, number]; type: string; modifier?: string; road: string }>;
  source: "offline-road-graph";
};

type Edge = { to: number; distance: number; road: string };
type QueueItem = { node: number; score: number };
class MinHeap {
  private items: QueueItem[] = [];
  get size() { return this.items.length; }
  push(item: QueueItem) {
    const data = this.items;
    data.push(item);
    let index = data.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (data[parent].score <= item.score) break;
      data[index] = data[parent]; index = parent;
    }
    data[index] = item;
  }
  pop(): QueueItem | undefined {
    const data = this.items;
    const first = data[0];
    const last = data.pop();
    if (!first || !last || !data.length) return first;
    let index = 0;
    while (index * 2 + 1 < data.length) {
      let child = index * 2 + 1;
      if (child + 1 < data.length && data[child + 1].score < data[child].score) child += 1;
      if (data[child].score >= last.score) break;
      data[index] = data[child]; index = child;
    }
    data[index] = last;
    return first;
  }
}

export class RoadGraph {
  private adjacency = new Map<number, Edge[]>();
  private points: Array<[number, number, number]>;
  constructor(public readonly data: RoadPackage) {
    this.points = Object.entries(data.nodes).map(([id, point]) => [Number(id), point[0], point[1]]);
    for (const road of data.roads) {
      for (let index = 1; index < road.nodes.length; index += 1) {
        const a = road.nodes[index - 1], b = road.nodes[index];
        const pa = data.nodes[a], pb = data.nodes[b];
        if (!pa || !pb) continue;
        const distance = metersBetween({ lat: pa[0], lng: pa[1] }, { lat: pb[0], lng: pb[1] });
        if (!Number.isFinite(distance) || distance <= 0) continue;
        if (road.oneway !== -1) this.add(a, { to: b, distance, road: road.name });
        if (road.oneway !== 1) this.add(b, { to: a, distance, road: road.name });
      }
    }
  }
  private add(from: number, edge: Edge) {
    const list = this.adjacency.get(from) || [];
    list.push(edge);
    this.adjacency.set(from, list);
  }
  private nearest(point: NavPoint) {
    let id = -1, distance = Infinity;
    for (const [candidate, lat, lng] of this.points) {
      const meters = metersBetween(point, { lat, lng });
      if (meters < distance) { id = candidate; distance = meters; }
    }
    return { id, distance };
  }
  route(from: NavPoint, to: NavPoint, phase: "pickup" | "trip"): LocalRoute | null {
    const start = this.nearest(from), end = this.nearest(to);
    if (start.id < 0 || end.id < 0 || start.distance > 180 || end.distance > 180) return null;
    const scores = new Map<number, number>([[start.id, 0]]);
    const previous = new Map<number, { node: number; edge: Edge }>();
    const queue = new MinHeap();
    queue.push({ node: start.id, score: 0 });
    while (queue.size) {
      const current = queue.pop()!;
      if (current.score !== scores.get(current.node)) continue;
      if (current.node === end.id) break;
      for (const edge of this.adjacency.get(current.node) || []) {
        const score = current.score + edge.distance;
        if (score >= (scores.get(edge.to) ?? Infinity)) continue;
        scores.set(edge.to, score);
        previous.set(edge.to, { node: current.node, edge });
        queue.push({ node: edge.to, score });
      }
    }
    if (!scores.has(end.id)) return null;
    const path = [end.id];
    const edges: Edge[] = [];
    while (path[0] !== start.id) {
      const item = previous.get(path[0]);
      if (!item) return null;
      edges.unshift(item.edge);
      path.unshift(item.node);
    }
    const coordinates = path.map((id) => this.data.nodes[id]).filter(Boolean);
    if (coordinates.length < 2) return null;
    const steps: LocalRoute["steps"] = [];
    for (let index = 1; index < edges.length; index += 1) {
      if (edges[index].road === edges[index - 1].road || !edges[index].road) continue;
      const current = coordinates[index], before = coordinates[index - 1], after = coordinates[index + 1];
      if (!current || !before || !after) continue;
      const scale = Math.cos(current[0] * Math.PI / 180);
      const ax = (current[1] - before[1]) * scale, ay = current[0] - before[0];
      const bx = (after[1] - current[1]) * scale, by = after[0] - current[0];
      const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180 / Math.PI;
      const modifier = Math.abs(angle) < 25 ? "straight" : Math.abs(angle) > 150 ? "uturn" : angle > 0 ? "left" : "right";
      steps.push({ distanceMeters: Math.round(edges[index].distance), location: [current[1], current[0]], type: "turn", modifier, road: edges[index].road });
    }
    const distanceMeters = Math.round(scores.get(end.id)! + start.distance + end.distance);
    const durationSeconds = Math.max(1, Math.round(distanceMeters / 8.3)); // local estimate: 30 km/h
    return { phase, geometry: JSON.stringify({ type: "LineString", coordinates: coordinates.map(([lat, lng]) => [lng, lat]) }), distanceMeters, durationSeconds, steps, source: "offline-road-graph" };
  }
}
