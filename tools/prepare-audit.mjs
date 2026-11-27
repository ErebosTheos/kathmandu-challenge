import { readFile, writeFile } from 'node:fs/promises';

const read = async name => JSON.parse(await readFile(new URL('../data/raw/valley-' + name + '.json', import.meta.url), 'utf8'));
const [stopsData, roadsData] = await Promise.all([read('stops'), read('roads')]);
const origin = { lat: 27.6786343, lon: 85.3495325 };
const metres = 111195;
const longitudeMetres = metres * Math.cos(origin.lat * Math.PI / 180);
const project = ({ lat, lon }) => [(lon - origin.lon) * longitudeMetres, (origin.lat - lat) * metres];
const roundPoint = point => point.map(value => Math.round(value));
const major = new Set(['trunk', 'primary', 'secondary']);
const junctionNodes = new Map();
const roads = [];
for (const way of roadsData.elements) {
  if (way.type !== 'way' || !major.has(way.tags?.highway) || !way.geometry || !way.nodes) continue;
  roads.push({ class: way.tags.highway, points: way.geometry.map(point => roundPoint(project(point))) });
  for (let index = 0; index < way.nodes.length; index++) {
    const id = way.nodes[index];
    if (!way.geometry[index]) continue;
    if (!junctionNodes.has(id)) junctionNodes.set(id, { kind: 'major-road junction', id, point: project(way.geometry[index]), links: new Set() });
    const entry = junctionNodes.get(id);
    if (index) entry.links.add(way.nodes[index - 1]);
    if (index + 1 < way.nodes.length) entry.links.add(way.nodes[index + 1]);
  }
}
const nodes = stopsData.elements.filter(entry => entry.type === 'node' && Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
const signals = nodes.filter(entry => entry.tags?.highway === 'traffic_signals').map(entry => ({ kind: 'signal', id: entry.id, point: project(entry) }));
const junctions = [...junctionNodes.values()].filter(point => point.links.size >= 3);
const sites = [...signals, ...junctions];
const thresholds = { red: 30, amber: 75 }; // Assumed screening bands in metres.
const stops = nodes.filter(entry => entry.tags?.highway?.split(';').includes('bus_stop')
  || (entry.tags?.bus === 'yes' && entry.tags?.public_transport === 'platform')).map(entry => {
  const point = project(entry);
  let distance = Infinity;
  let nearest = null;
  for (const site of sites) {
    const gap = Math.hypot(point[0] - site.point[0], point[1] - site.point[1]);
    if (gap < distance) {
      distance = gap;
      nearest = site;
    }
  }
  return { id: entry.id, name: entry.tags.name ?? entry.tags['name:en'] ?? 'Unnamed stop ' + entry.id,
    point: roundPoint(point), distance: Math.round(distance * 10) / 10, nearest: { id: nearest.id, kind: nearest.kind },
    band: distance < thresholds.red ? 'red' : distance < thresholds.amber ? 'amber' : 'grey' };
}).sort((a, b) => a.distance - b.distance || a.id - b.id);
const allPoints = roads.flatMap(road => road.points).concat(stops.map(stop => stop.point));
const x = allPoints.map(point => point[0]);
const y = allPoints.map(point => point[1]);
const bounds = [Math.min(...x) - 400, Math.min(...y) - 400, Math.max(...x) + 400, Math.max(...y) + 400];
const output = {
  source: '© OpenStreetMap contributors (ODbL)', extractedAt: stopsData.osm3s.timestamp_osm_base,
  origin, thresholds, bounds, roads, stops, signals: signals.length, junctions: junctions.length,
};
await writeFile(new URL('../data/valley-audit.json', import.meta.url), JSON.stringify(output) + '\n');
console.log('Valley audit: ' + stops.length + ' stops, ' + signals.length + ' signals, ' + junctions.length + ' major-road junctions.');
