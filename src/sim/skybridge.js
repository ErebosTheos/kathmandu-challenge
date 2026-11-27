import { crossingSite, sample } from './geometry.js';
import { PED } from './params.js';

export const SKYBRIDGE = {
  height: 5.8,
  width: 2.8,
  stairRun: 12,
  stairSpeed: 0.85,
};

// Local offsets keep the stairs clear of the mapped frontage and slip lanes.
const placements = {
  north: { along: 11, setbacks: [3.5, 3.5] },
  east: { along: 31, setbacks: [3.5, 3.5] },
  south: { along: 17, setbacks: [11.5, 10] },
};

export function skybridgeRoute(road) {
  const site = crossingSite(road);
  const lane = road.incoming[0].path;
  const inbound = sample(lane, lane.length);
  let alongX = -site.dz;
  let alongZ = site.dx;
  if (inbound.dx * alongX + inbound.dz * alongZ > 0) {
    alongX = -alongX;
    alongZ = -alongZ;
  }

  const { along, setbacks } = placements[road.id];
  const left = -site.width / 2 - setbacks[0], right = site.width / 2 + setbacks[1];
  const point = (across, along, y) => ({
    x: site.x + site.dx * across + alongX * along,
    y,
    z: site.z + site.dz * across + alongZ * along,
  });
  const { height, stairRun, stairSpeed } = SKYBRIDGE;
  const points = [
    point(left, along + stairRun, 0),
    point(left, along, height),
    point(right, along, height),
    point(right, along + stairRun, 0),
  ];
  const speeds = [stairSpeed, PED.crossingSpeed, stairSpeed];
  let duration = 0;
  const segments = speeds.map((speed, i) => {
    const from = points[i], to = points[i + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const segment = { from, to, start: duration, seconds: length / speed };
    duration += segment.seconds;
    return segment;
  });
  return { segments, duration };
}

export function sampleSkybridge(route, elapsed, forward, offset, target) {
  const time = Math.min(route.duration, Math.max(0, forward ? elapsed : route.duration - elapsed));
  const segment = route.segments.find(part => time < part.start + part.seconds) ?? route.segments.at(-1);
  const progress = Math.max(0, Math.min(1, (time - segment.start) / segment.seconds));
  const { from, to } = segment;
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  target.x = from.x + dx * progress + dz / length * offset;
  target.y = from.y + (to.y - from.y) * progress;
  target.z = from.z + dz * progress - dx / length * offset;
  target.heading = Math.atan2(dx, dz) - Math.PI / 2 + (forward ? 0 : Math.PI);
  return target;
}
