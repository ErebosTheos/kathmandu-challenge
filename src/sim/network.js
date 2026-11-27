import geo from '../../data/koteshwor.geo.json' with { type: 'json' };
import { conflictInterval, connector, offsetPath, polyline, projectToPath, sample, slicePath } from './geometry.js';
import { NETWORK, PED, TRANSIT } from './params.js';
import { ARM_IDS, destinationFor, TURN_IDS } from './scenarios.js';

function chain(roads, ids) {
  return polyline(ids.flatMap(id => {
    const piece = roads.get(Math.abs(id));
    return piece ? (id < 0 ? piece.points.slice().reverse() : piece.points) : [];
  }));
}

export function createNetwork(map = geo) {
  const roads = new Map(map.roads.filter(road => road.part === 0).map(road => [road.id, road]));
  const lanes = [];
  const movements = [];
  const arms = {};
  const makeLane = (arm, kind, path, index, width) => {
    const lane = { id: lanes.length, arm, kind, path, index, width, vehicles: [], moves: {} };
    lanes.push(lane);
    return lane;
  };
  for (const id of ARM_IDS) {
    const metadata = map.arms.find(arm => arm.id === id);
    const inRoad = roads.get(Math.abs(metadata.incoming[0]));
    const outRoad = roads.get(Math.abs(metadata.outgoing[0]));
    const inPath = chain(roads, metadata.incoming);
    const outPath = chain(roads, metadata.outgoing);
    const inCenter = polyline(slicePath(inPath, NETWORK.stopSetback[id], inPath.length).points.slice().reverse());
    const outCenter = slicePath(outPath, NETWORK.exitSetback[id], outPath.length);
    const incomingCount = inRoad.oneway ? inRoad.lanes : Math.max(1, Math.floor(inRoad.lanes / 2));
    // The southwest outbound lead-in is widened inside the junction; the
    // uninterrupted NH39 carriageway immediately beyond it has two lanes.
    const downstreamRoad = roads.get(Math.abs(metadata.outgoing[1])) ?? outRoad;
    const outgoingCount = outRoad.oneway ? Math.min(outRoad.lanes, downstreamRoad.lanes) : Math.max(1, Math.floor(outRoad.lanes / 2));
    const inWidth = Math.min(NETWORK.usableWidth, inRoad.width / inRoad.lanes);
    const outWidth = Math.min(NETWORK.usableWidth, outRoad.width / outRoad.lanes);
    const direction = NETWORK.leftHandTraffic ? 1 : -1;
    const incoming = Array.from({ length: incomingCount }, (_, i) => makeLane(id, 'incoming',
      offsetPath(inCenter, direction * inWidth * (inRoad.oneway ? (incomingCount - 1) / 2 - i : i + 0.5)), i, inWidth));
    const outgoing = Array.from({ length: outgoingCount }, (_, i) => makeLane(id, 'outgoing',
      offsetPath(outCenter, direction * outWidth * (outRoad.oneway ? (outgoingCount - 1) / 2 - i : i + 0.5)), i, outWidth));
    for (const lane of outgoing) lane.feeders = [];
    const filter = incomingCount > 1 && inWidth > NETWORK.filterWidth
      ? makeLane(id, 'filter', offsetPath(inCenter, direction * inWidth * (incomingCount - 2) / 2), 0, NETWORK.filterWidth)
      : null;
    const curbLane = incoming[0];
    const curb = offsetPath(curbLane.path, direction * (inWidth / 2 + NETWORK.curbOffset));
    const bay = makeLane(id, 'bay', offsetPath(curbLane.path, direction * NETWORK.bayOffset), 0, inWidth);
    const cross = map.crossings.find(crossing => crossing.id === metadata.crossing);
    const stopLine = incoming.map(lane => sample(lane.path, lane.path.length));
    const stops = (metadata.stops ?? []).map(({ osmId, side }) => {
      const marker = map.busStops.find(stop => stop.id === osmId);
      const lane = side === 'far' ? outgoing[0] : curbLane;
      const { s } = projectToPath(lane.path, marker.point);
      return { osmId, side, arm: id, laneIndex: 0, point: marker.point, assumed: false,
        distance: side === 'far' ? s : lane.path.length - s };
    });
    if (!stops.some(stop => stop.side === 'near')) {
      const distance = TRANSIT.informalRange[1];
      const point = sample(curb, curb.length - distance);
      stops.push({ osmId: null, side: 'near', arm: id, laneIndex: 0, point: [point.x, point.z], assumed: true, distance });
    }
    const crossing = { id, osmId: cross?.id ?? null, point: cross?.point ?? [stopLine[0].x, stopLine[0].z],
      length: Math.max(PED.minimumWidth, incomingCount * inWidth + outgoingCount * outWidth), approaching: [] };
    arms[id] = { ...metadata, incoming, outgoing, roadLanes: [...incoming, ...outgoing], filter, curb, bay, stopLine, crossing,
      stops, officialStop: stops.find(stop => stop.side === 'near') };
  }

  for (const id of ARM_IDS) {
    const arm = arms[id];
    const entries = [...arm.incoming, ...(arm.filter ? [arm.filter] : [])];
    for (const from of entries) {
      for (const turn of TURN_IDS) {
        const destination = destinationFor(id, turn);
        if (!destination) continue;
        const toArm = arms[destination];
        const defaultLane = turn === 'right' ? toArm.outgoing.length - 1 : Math.min(from.index, toArm.outgoing.length - 1);
        const variants = toArm.outgoing.map(to => {
          let path = connector(from.path, to.path, NETWORK.curveResolution);
          if (id === 'west') {
            const local = roads.get(arm.northConnector).points;
            path = polyline([from.path.points.at(-1), ...local, to.path.points[0]]);
          } else if (to.arm === 'west') {
            path = polyline([from.path.points.at(-1), toArm.junctionPoint, to.path.points[0]]);
          }
          const move = makeLane(id, 'movement', path, 0, from.width);
          Object.assign(move, { from, to, turn, conflicts: [], giveWay: arm.priority === 'give-way' });
          movements.push(move);
          to.feeders.push(move);
          toArm.crossing.approaching.push(move);
          return move;
        });
        const move = variants[turn === 'left' ? 0 : defaultLane];
        move.variants = variants;
        from.moves[turn] = move;
      }
    }
  }
  for (let i = 0; i < movements.length; i++) {
    const first = movements[i];
    for (let j = 0; j < i; j++) {
      const second = movements[j];
      const clearance = first.from === second.from ? NETWORK.sharedLaneClearance : NETWORK.clearance;
      const a = conflictInterval(first.path, second.path, clearance);
      const b = conflictInterval(second.path, first.path, clearance);
      if (Number.isFinite(a.start) && Number.isFinite(b.start)) {
        first.conflicts.push({ lane: second, from: a.start, until: b.end });
        second.conflicts.push({ lane: first, from: b.start, until: a.end });
      }
    }
  }
  return { origin: map.origin, arms, lanes, movements };
}
