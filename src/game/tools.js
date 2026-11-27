import { crossingSite, projectToPath, sample } from '../sim/geometry.js';
import { NETWORK, TOOLS } from '../sim/params.js';
import { ARM_IDS } from '../sim/scenarios.js';

export { crossingSite };

export const ARM = { north: 'Ring Road north', east: 'Araniko Highway', south: 'Ring Road southwest', west: 'Seti O.P. Marg' };
export const VEHICLE = { motorcycle: 'Motorcycle', car: 'Car', taxi: 'Taxi', microbus: 'Microbus', tempo: 'Safa tempo', sajha: 'Sajha bus', bus: 'Long-route bus', truck: 'Truck' };
export const TOOLS_UI = [
  ['moveStop', 'Move bus stop', 'bus'],
  ['noStoppingZone', 'No-stopping zone', 'ban'],
  ['busBay', 'Bus bay', 'bay'],
  ['signalTiming', 'Signal timing', 'signal'],
  ['policeOfficer', 'Traffic officer', 'officer'],
  ['zebra', 'Pedestrian crossing', 'crossing'],
  ['freeLeft', 'Free left turn', 'turn'],
  ['infoCampaign', 'Public campaign', 'campaign'],
];
export const toolName = type => type === 'pedestrianSignal' ? 'Pedestrian signal' : TOOLS_UI.find(entry => entry[0] === type)?.[1] ?? type;
export const npr = value => Number.isFinite(value) ? 'NPR ' + Math.round(value).toLocaleString('en-IN') : 'Unlimited';
export const clock = seconds => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
export const signed = (value, places = 0) => {
  const rounded = Number(value.toFixed(places));
  return (rounded > 0 ? '+' : rounded < 0 ? '−' : '') + Math.abs(rounded).toLocaleString('en', { maximumFractionDigits: places });
};

export function curbSite(road, distance, side = 'near', laneIndex = 0) {
  const far = side === 'far';
  const lane = far ? road.outgoing[laneIndex] : road.incoming[0];
  const point = sample(lane.path, far ? distance : lane.path.length - distance);
  const offset = lane.width / 2 + NETWORK.curbOffset;
  point.x += point.dz * offset;
  point.z -= point.dx * offset;
  return point;
}

export function locate(state, tool, options, point) {
  const { network, rules } = state;
  if (tool === 'signalTiming' || tool === 'infoCampaign') {
    return { input: { type: tool, plan: options.plan }, x: 0, z: 0 };
  }
  const type = tool === 'zebra' && options.pedSignal ? 'pedestrianSignal' : tool;
  const far = type === 'moveStop' && options.side === 'far';
  const crossing = type === 'zebra' || type === 'pedestrianSignal';
  let best;
  for (const arm of ARM_IDS) {
    if (type === 'moveStop' && !far && arm !== options.sourceArm) continue;
    if (type === 'pedestrianSignal' && arm === 'west') continue;
    const road = network.arms[arm];
    const path = far ? road.outgoing[0].path : road.incoming[0].path;
    const projected = projectToPath(path, [point.x, point.z]);
    let distance = Math.round(far ? projected.s : path.length - projected.s);
    if (type === 'moveStop') distance = Math.max(TOOLS.moveStop.minDistance, Math.min(distance, TOOLS.moveStop.maxDistance));
    if (type === 'noStoppingZone') distance = Math.min(distance, Math.floor(path.length - options.length));
    const anchor = crossing ? crossingSite(road) : curbSite(road, type === 'freeLeft' ? 4 : distance, far ? 'far' : 'near');
    const gap = Math.hypot(point.x - anchor.x, point.z - anchor.z);
    if (best && best.gap <= gap) continue;
    let input = { type, arm, distance };
    if (type === 'moveStop') {
      const source = network.arms[options.sourceArm];
      input = { ...input, arm: source.id, stopId: options.stopId ?? source.officialStop.osmId, side: options.side, exitArm: far ? arm : undefined };
    }
    if (type === 'noStoppingZone') Object.assign(input, { start: distance, length: options.length });
    if (type === 'freeLeft') input.enabled = !rules.arms[arm].channelizedLeft;
    if (type === 'policeOfficer') input.manual = options.manual;
    best = { ...anchor, distance, side: far ? 'far' : 'near', arm, gap, input };
  }
  return best && best.gap <= 24 ? best : null;
}

export function effect(type, site, options, scenario) {
  switch (type) {
    case 'moveStop': return (site?.side ?? options.side) === 'far'
      ? 'Shifts boarding onto the selected exit. Leave space for a queue between the stop and junction.'
      : 'Keeps boarding on this approach. Moving upstream can clear the stop line while adding walking.';
    case 'noStoppingZone': return 'Redirects complying drivers outside the marked curb. An officer can raise compliance.';
    case 'busBay': return 'Vehicles boarding within ' + TOOLS.busBay.halfLength + ' m of the bay leave the traffic lane.';
    case 'signalTiming': return 'Extra green serves the selected approach at the expense of the others.';
    case 'policeOfficer': return 'Raises compliance for informal stops within ' + TOOLS.policeOfficer.radius + ' m. ' + npr(TOOLS.policeOfficer.perMinute) + ' per simulated minute.';
    case 'zebra': return 'Drivers can yield after pedestrians wait briefly. Queueing may grow while people cross.';
    case 'pedestrianSignal': return 'Provides protected crossings during another approach’s green if enough crossing time remains.';
    case 'freeLeft': return site?.input.enabled === false ? 'Makes left turns wait for their normal signal.' : 'Allows eligible curb-lane left turns outside the normal signal phase.';
    case 'infoCampaign': return 'Reduces willingness to stop informally by ' + Math.round(TOOLS.infoCampaign.compliance * 100) + '% of the assumed rate across the junction.';
    default: return scenario;
  }
}

export function locationLabel(site) {
  const { input, arm, distance, side } = site;
  if (input.type === 'freeLeft' || input.type === 'zebra' || input.type === 'pedestrianSignal') return ARM[arm];
  return ARM[arm] + ' · ' + distance + ' m ' + (side === 'far' ? 'past exit entrance' : 'before stop line');
}
