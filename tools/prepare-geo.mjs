import { readFile, writeFile } from 'node:fs/promises';

const origin = { lat: 27.6786343, lon: 85.3495325, osmNodeId: 31228768 };
const radius = 450;
const buildingRadius = 320;
const radians = Math.PI / 180;
const earthRadius = 6371008.8;
const { elements } = JSON.parse(await readFile(new URL('../data/raw/koteshwor-api.json', import.meta.url)));
const round = (n) => Math.round(n * 100) / 100;
const project = ({ lat, lon }) => [
  earthRadius * radians * Math.cos(origin.lat * radians) * (lon - origin.lon),
  earthRadius * radians * (origin.lat - lat),
];
const nodes = new Map(elements.filter(({ type }) => type === 'node').map(node => [node.id, node]));
const ways = new Map(elements.filter(({ type }) => type === 'way').map(way => [way.id, way]));
const pointsOf = way => way.nodes.map(id => project(nodes.get(id)));
const distance = ([x, z]) => Math.hypot(x, z);

// Clip each straight segment against the circle, retaining distinct pieces on re-entry.
function clip(points) {
  const pieces = [];
  let current;
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1];
    const dx = points[i][0] - x;
    const dz = points[i][1] - z;
    const a = dx * dx + dz * dz;
    if (!a) continue;
    const b = x * dx + z * dz;
    const discriminant = b * b - a * (x * x + z * z - radius * radius);
    if (discriminant <= 0) {
      current = undefined;
      continue;
    }
    const start = Math.max(0, (-b - Math.sqrt(discriminant)) / a);
    const end = Math.min(1, (-b + Math.sqrt(discriminant)) / a);
    if (start >= end) {
      current = undefined;
      continue;
    }
    if (!current || start > 0) {
      current = [[round(x + dx * start), round(z + dz * start)]];
      pieces.push(current);
    }
    const next = [round(x + dx * end), round(z + dz * end)];
    if (next.some((value, axis) => value !== current.at(-1)[axis])) current.push(next);
    if (end < 1) current = undefined;
  }
  return pieces.filter(piece => piece.length > 1);
}

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const footClasses = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor']);
const roads = [];
const footways = [];
for (const way of ways.values()) {
  const tags = way.tags ?? {};
  if (!tags.highway) continue;
  for (const [part, points] of clip(pointsOf(way)).entries()) {
    const base = { id: way.id, part, highway: tags.highway, name: tags.name ?? null, ref: tags.ref ?? null, points };
    if (footClasses.has(tags.highway)) {
      footways.push({ ...base, footway: tags.footway ?? null, bridge: tags.bridge === 'yes', layer: Number(tags.layer ?? 0) });
      continue;
    }
    const oneway = ['yes', '1', 'true', '-1'].includes(tags.oneway)
      || (tags.oneway !== 'no' && ['roundabout', 'circular'].includes(tags.junction));
    const main = ['motorway', 'trunk', 'primary'].includes(tags.highway);
    const directionalLanes = (number(tags['lanes:forward']) ?? 0) + (number(tags['lanes:backward']) ?? 0);
    const lanes = number(tags.lanes) ?? (directionalLanes || (main ? (oneway ? 2 : 4) : (oneway ? 1 : 2)));
    const width = number(tags.width?.replace(/\s*m$/, '')) ?? round(lanes * (main ? 3.5 : 3));
    if (tags.oneway === '-1') points.reverse();
    roads.push({ ...base, lanes, oneway, width });
  }
}

function assembleRings(members) {
  const parts = members.map(member => ways.get(member.ref)?.nodes.slice()).filter(Boolean);
  const rings = [];
  while (parts.length) {
    const ring = parts.shift();
    while (ring[0] !== ring.at(-1)) {
      const next = parts.findIndex(part => part[0] === ring.at(-1) || part.at(-1) === ring.at(-1));
      if (next < 0) break;
      const [part] = parts.splice(next, 1);
      if (part[0] !== ring.at(-1)) part.reverse();
      ring.push(...part.slice(1));
    }
    if (ring.length > 3 && ring[0] === ring.at(-1)) rings.push(pointsOf({ nodes: ring }));
  }
  return rings;
}

function inside([x, z], ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) result = !result;
  }
  return result;
}
function segmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz);
}

function withinBuildingRadius(outer) {
  return inside([0, 0], outer) || outer.slice(1).some((end, i) => segmentDistance([0, 0], outer[i], end) <= buildingRadius);
}

const quadrant = ([x, z]) => (z <= 0 ? 'N' : 'S') + (x >= 0 ? 'E' : 'W');
const centre = ring => ring.slice(0, -1).reduce(([x, z], point) => [
  x + point[0] / (ring.length - 1), z + point[1] / (ring.length - 1),
], [0, 0]);
const buildingCounts = Object.fromEntries(['NW', 'NE', 'SW', 'SE'].map(q => [q, {
  rawExtract: 0, rawWithin320m: 0, keptOSM: 0, filler: 0,
}]));

const relations = elements.filter(e => e.type === 'relation' && e.tags?.building && e.tags.building !== 'no');
const buildingMembers = new Set(relations.flatMap(relation => relation.members.filter(m => m.type === 'way').map(m => m.ref)));
const buildings = [];
function addBuilding(source, polygons) {
  const { id, tags, type } = source;
  const levels = number(tags['building:levels']) ?? 3 + id % 5;
  if (!polygons.length) return;
  const local = polygons.filter(([outer]) => withinBuildingRadius(outer));
  const area = buildingCounts[quadrant(centre((local[0] ?? polygons[0])[0]))];
  area.rawExtract++;
  if (!local.length) return;
  area.rawWithin320m++;
  buildings.push({ id, type, levels, polygons: local.map(p => p.map(ring => ring.map(point => point.map(round)))) });
  area.keptOSM++;
}
for (const way of ways.values()) {
  if (way.tags?.building && way.tags.building !== 'no' && !buildingMembers.has(way.id)
      && way.nodes.length > 3 && way.nodes[0] === way.nodes.at(-1)) {
    addBuilding(way, [[pointsOf(way)]]);
  }
}
for (const relation of relations) {
  const inner = assembleRings(relation.members.filter(m => m.role === 'inner'));
  const outer = assembleRings(relation.members.filter(m => m.role === 'outer' || m.role === ''));
  addBuilding(relation, outer.map(ring => [ring, ...inner.filter(hole => inside(hole[0], ring))]));
}

// Fill empty road frontage (any quadrant) where OSM has no mapped buildings. An enclosing circle keeps each footprint
// clear of other footprints, mapped carriageways and paths, including at bends and side roads.
const fillerPlots = [];
const frontage = roads.filter(road => road.ref === 'NH39' || road.ref === 'NH34'
  || ['residential', 'tertiary', 'secondary'].includes(road.highway));
const corridors = [...roads, ...footways];
const realFootprints = buildings.flatMap(building => building.polygons.map(([outer]) => outer));
for (const road of frontage) {
  const spacing = 10;
  let next = spacing / 2;
  for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1];
    const [bx, bz] = road.points[i];
    const length = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / length;
    const dz = (bz - az) / length;
    for (; next < length; next += spacing) {
      for (const side of [-1, 1]) {
        const seed = (road.id + i * 31 + Math.floor(next) * 17 + side) >>> 0;
        const halfWidth = 4 + seed % 3;
        const halfDepth = 4 + seed % 4;
        const clearance = Math.hypot(halfWidth, halfDepth);
        let point;
        for (const setback of [1.5, 5, 9, 14, 20, 27]) {
          const offset = road.width / 2 + clearance + setback;
          const candidate = [ax + dx * next - side * dz * offset, az + dz * next + side * dx * offset];
          if (distance(candidate) + clearance > buildingRadius
              || distance(candidate) - clearance < 45) continue;
          if (corridors.some(other => other.points.slice(1).some((end, j) =>
            segmentDistance(candidate, other.points[j], end) < (other.width ?? 2) / 2 + clearance + 1))) continue;
          if (realFootprints.some(ring => inside(candidate, ring) || ring.slice(1).some((end, j) =>
            segmentDistance(candidate, ring[j], end) < clearance + 2))) continue;
          if (fillerPlots.some(plot => Math.hypot(candidate[0] - plot.point[0], candidate[1] - plot.point[1]) < clearance + plot.clearance + 1)) continue;
          point = candidate;
          break;
        }
        if (!point) continue;
        const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => [
          round(point[0] + u * halfWidth * dx - v * halfDepth * dz),
          round(point[1] + u * halfWidth * dz + v * halfDepth * dx),
        ]);
        fillerPlots.push({ point, clearance });
        buildings.push({ id: -fillerPlots.length, type: 'way', levels: 3 + (seed >>> 3) % 5,
          polygons: [[ring]], filler: true, source: 'procedural, not from OSM' });
        buildingCounts[(point[1] > 0 ? 'S' : 'N') + (point[0] > 0 ? 'E' : 'W')].filler++;
      }
    }
    next -= length;
  }
}

const markers = { busStops: [], signals: [], crossings: [] };
for (const node of nodes.values()) {
  const tags = node.tags ?? {};
  const local = project(node);
  if (distance(local) > radius) continue;
  const point = local.map(round);
  const base = { id: node.id, name: tags.name ?? null, point };
  if (tags.highway === 'traffic_signals') markers.signals.push(base);
  if (tags.highway === 'bus_stop' || (tags.public_transport === 'stop_position' && tags.bus === 'yes')) {
    markers.busStops.push({ ...base, publicTransport: tags.public_transport ?? null });
  }
  if (tags.highway === 'crossing' || tags.crossing) {
    markers.crossings.push({ ...base, crossing: tags.crossing ?? null, markings: tags['crossing:markings'] ?? null });
  }
}

// Ordered from the junction out. Negative IDs reverse the OSM way direction.
const arms = [
  { id: 'north', label: 'Ring Road north', destination: 'Tinkune / airport', incoming: [-193289327], outgoing: [193289326, 591357319], stops: [{ osmId: 4030822684, side: 'near' }, { osmId: 3461553725, side: 'far' }], crossing: 9992874720 },
  { id: 'south', label: 'Ring Road southwest', destination: 'Balkumari / Satdobato', incoming: [-648697035], outgoing: [215507255, 416294069, 196277319], crossing: 10920911258 },
  { id: 'east', label: 'Araniko Highway east', destination: 'Bhaktapur', incoming: [-226834863], outgoing: [194607856, 1132407062, 231882049, 229063563], crossing: 9992874728 },
  { id: 'west', label: 'Seti O.P. Marg', destination: 'Local access', priority: 'give-way', junctionPoint: project(nodes.get(6275508140)).map(round), northConnector: 1132401297, incoming: [-1132401301, -182319937], outgoing: [-1132401301, -182319937], crossing: 9992835074 },
];
const roadById = new Map(roads.filter(road => road.part === 0).map(road => [road.id, road]));
function chain(ids) {
  const result = [];
  for (const id of ids) {
    const road = roadById.get(Math.abs(id));
    if (!road) continue; // The next OSM way may lie entirely outside the extraction radius.
    const points = id < 0 ? road.points.slice().reverse() : road.points;
    for (const point of points) {
      if (!result.length || point.some((value, axis) => value !== result.at(-1)[axis])) result.push(point);
    }
  }
  return result;
}
for (const arm of arms) {
  const source = roadById.get(Math.abs(arm.incoming[0]));
  const line = chain(arm.incoming);
  let remaining = 30;
  let [x, z] = line.at(-1);
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const length = Math.hypot(bx - ax, bz - az);
    if (length >= remaining) {
      x = ax + (bx - ax) * remaining / length;
      z = az + (bz - az) * remaining / length;
      break;
    }
    remaining -= length;
  }
  const bearing = ((Math.atan2(x - line[0][0], line[0][1] - z) / radians) + 360) % 360;
  Object.assign(arm, { name: source.name, ref: source.ref, nearHeadingDegrees: round(bearing), headingConvention: 'degrees clockwise from north, measured outbound over the first 30 m of the approach' });
}
const geo = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  source: 'data/raw/koteshwor-api.json',
  origin,
  coordinates: { units: 'metres', order: ['x', 'z'], x: 'east', z: 'south', projection: 'local equirectangular', radius, buildingRadius },
  junctionNotes: 'NH39 runs north and southwest. NH34 starts almost due south and bends east toward Bhaktapur. F86 joins NH34 roughly 490 m away, around x=319, z=370. Seti O.P. Marg shares OSM node 6275508140 with NH39 and shares node 2619331841 with Shri Shanta Marg. The minor connection is documented by JICA; give-way operation is a simulation assumption.',
  metadata: { buildingCounts, fillerBuildings: fillerPlots.length },
  arms,
  roads,
  buildings,
  ...markers,
  footways,
};
const listKeys = ['arms', 'roads', 'buildings', 'busStops', 'signals', 'crossings', 'footways'];
// Keep one feature per line so the generated file remains reviewable.
const columns = Object.entries(geo).map(([key, value]) => {
  const encoded = listKeys.includes(key) ? '[\n' + value.map(feature => '    ' + JSON.stringify(feature)).join(',\n') + '\n  ]' : JSON.stringify(value);
  return '  ' + JSON.stringify(key) + ': ' + encoded;
});
await writeFile(new URL('../data/koteshwor.geo.json', import.meta.url), '{\n' + columns.join(',\n') + '\n}\n');
console.log(`${roads.length} roads, ${buildings.length} buildings, ${markers.busStops.length} stops, ${markers.signals.length} signals, ${markers.crossings.length} crossings, ${footways.length} footways`);
console.table(buildingCounts);
