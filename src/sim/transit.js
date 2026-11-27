import { DRIVER, TOOLS, TRANSIT } from './params.js';
import { clamp } from './signals.js';

export function transitTraits(random, vehicle, demand) {
  const type = vehicle.spec;
  if (!type.transit || random() >= demand.stopShare) return null;
  return {
    informal: random(), informalDistance: TRANSIT.informalRange[0] + random() * (TRANSIT.informalRange[1] - TRANSIT.informalRange[0]),
    obedience: random(), passengers: Math.floor(random() * (type.boarders + 1)),
    distance: 0, s: 0, lane: null, side: null, walkingDistance: 0, bay: false, remaining: 0, started: null, completed: false,
    delayedVehicles: new Set(), delayedSeconds: 0, greenDelayedSeconds: 0,
  };
}

export function planStop(vehicle, network, rules, scenario) {
  const stop = vehicle.stop;
  if (!stop || stop.completed || stop.started !== null) return;
  const arm = network.arms[vehicle.arm];
  const local = rules.arms[vehicle.arm];
  const exit = rules.arms[vehicle.destination];
  const near = local.stops.find(site => site.side === 'near');
  const far = exit.stops.find(site => site.side === 'far' && site.relocated)
    ?? exit.stops.find(site => site.side === 'far');
  // Relocated stops are served by traffic already travelling towards that exit.
  const official = far && (far.relocated || near?.assumed) ? far : near ?? far;
  let officerCompliance = 0;
  for (const officer of local.officers) {
    if (Math.abs(officer.distance - stop.informalDistance) <= TOOLS.policeOfficer.radius) officerCompliance = TOOLS.policeOfficer.compliance;
  }
  const compliance = 1 - (1 - local.campaign) * (1 - officerCompliance);
  let site = stop.informal < scenario.informal * (1 - compliance)
    ? { side: 'near', arm: arm.id, laneIndex: 0, distance: stop.informalDistance }
    : official;
  for (const zone of local.zones) {
    if (site?.side === 'near' && site.distance >= zone.start && site.distance <= zone.end
        && stop.obedience < 1 - (1 - TOOLS.noStoppingZone.compliance) * (1 - compliance)) {
      site = official && (official.side === 'far' || official.distance < zone.start || official.distance > zone.end)
        ? official
        : { side: 'near', arm: arm.id, laneIndex: 0, distance: zone.end + TRANSIT.fallbackDistance };
    }
  }
  if (!site) {
    stop.lane = stop.side = null;
    return;
  }
  const farSide = site.side === 'far';
  const lane = network.arms[site.arm][farSide ? 'outgoing' : 'incoming'][site.laneIndex];
  const distance = clamp(site.distance, vehicle.length / 2 + TRANSIT.stopLineClearance, lane.path.length - vehicle.length);
  const s = farSide ? distance : lane.path.length - distance;
  if (!farSide && vehicle.lane && distance + TRANSIT.stopTolerance > vehicle.lane.path.length - vehicle.s) {
    if (stop.side === 'far' || (stop.lane && stop.distance <= vehicle.lane.path.length - vehicle.s)) return;
    stop.lane = stop.side = null;
    return;
  }
  Object.assign(stop, {
    s, distance, lane, side: site.side, osmId: site.osmId ?? null,
    walkingDistance: site.relocated
      ? (farSide ? Math.hypot(site.point[0] - site.originalPoint[0], site.point[1] - site.originalPoint[1])
        : Math.max(0, distance - arm.officialStop.distance))
      : 0,
    bay: !farSide && local.bays.some(bay => Math.abs((bay.distance ?? near?.distance) - distance) <= TOOLS.busBay.halfLength),
  });
}

export function beginDwell(vehicle, time, scenario, arm, events) {
  const stop = vehicle.stop;
  const dwell = (vehicle.spec.baseDwell + stop.passengers * vehicle.spec.boardingTime) * scenario.dwell;
  stop.started = time;
  stop.remaining = dwell;
  vehicle.speed = 0;
  if (stop.bay) {
    vehicle.s = arm.bay.path.length - stop.distance;
    vehicle.lane = arm.bay;
  }
  events.emit('transit-dwell-started', time, {
    arm: arm.id, laneId: vehicle.lane.id, vehicleId: vehicle.id, vehicleType: vehicle.type,
    plate: vehicle.plate, side: stop.side, osmId: stop.osmId, distance: stop.distance, passengers: stop.passengers, plannedDuration: dwell, blocking: !stop.bay,
  });
}

export function endDwell(vehicle, time, arm, events) {
  const stop = vehicle.stop;
  stop.completed = true;
  events.emit(stop.bay ? 'transit-dwell-ended' : 'curb-blockage', time, {
    arm: arm.id, laneId: stop.lane.id, vehicleId: vehicle.id, vehicleType: vehicle.type,
    plate: vehicle.plate, side: stop.side, osmId: stop.osmId, distance: stop.distance, duration: time - stop.started,
    passengers: stop.passengers, vehiclesLost: stop.delayedVehicles.size,
    vehicleSecondsLost: stop.delayedSeconds, greenVehicleSecondsLost: stop.greenDelayedSeconds,
    nearJunction: stop.distance <= TRANSIT.junctionInfluence,
  });
}

export function canBoard(vehicle) {
  const stop = vehicle.stop;
  return stop && !stop.completed && stop.started === null && vehicle.lane === stop.lane && Math.abs(vehicle.s - stop.s) <= TRANSIT.stopTolerance
    && vehicle.speed <= DRIVER.stoppedSpeed;
}
