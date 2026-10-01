export type RoutePixelPoint = { x: number; y: number };

function pointAtDistance(points: RoutePixelPoint[], distances: number[], distance: number): RoutePixelPoint {
  let index = 1;
  while (index < distances.length - 1 && distances[index] < distance) index += 1;
  const segmentLength = distances[index] - distances[index - 1];
  const fraction = segmentLength ? (distance - distances[index - 1]) / segmentLength : 0;
  return {
    x: points[index - 1].x + (points[index].x - points[index - 1].x) * fraction,
    y: points[index - 1].y + (points[index].y - points[index - 1].y) * fraction,
  };
}

/** Small forward-pointing chevrons placed on the projected routed street geometry. */
export function routeChevrons(points: RoutePixelPoint[], spacing = 76): RoutePixelPoint[][] {
  if (points.length < 2) return [];
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distances.push(distances[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  const total = distances[distances.length - 1];
  const margin = 35;
  if (total < margin * 2) return [];
  const chevrons: RoutePixelPoint[][] = [];
  const interval = Math.max(spacing, (total - margin * 2) / 159);
  for (let distance = margin; distance <= total - margin && chevrons.length < 160; distance += interval) {
    const base = pointAtDistance(points, distances, distance - 4);
    const tip = pointAtDistance(points, distances, distance + 4);
    const length = Math.hypot(tip.x - base.x, tip.y - base.y);
    if (length < 0.01) continue;
    const normalX = -(tip.y - base.y) / length;
    const normalY = (tip.x - base.x) / length;
    chevrons.push([
      { x: base.x + normalX * 3.2, y: base.y + normalY * 3.2 },
      tip,
      { x: base.x - normalX * 3.2, y: base.y - normalY * 3.2 },
    ]);
  }
  return chevrons;
}
