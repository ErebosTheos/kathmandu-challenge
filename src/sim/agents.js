import { DRIVER, PLATES, SATURATION, TOOLS, VEHICLES } from './params.js';
import { sample } from './geometry.js';
import { exponential } from './rng.js';
import { ARM_IDS, TURN_IDS } from './scenarios.js';
import { beginDwell, canBoard, endDwell, planStop, transitTraits } from './transit.js';
import { TUNNEL_SPEED, tunnelRoutes } from './tunnel.js';

const TYPES = Object.entries(VEHICLES);
const TRANSIT_SHARE = TYPES.reduce((sum, [, type]) => sum + (type.transit ? type.share : 0), 0);
const rampUp = (rate, distance) => Math.sqrt(Math.max(0, 2 * rate * distance));

export function nepaliPlate(random, spec) {
  const zone = PLATES.zones[Math.floor(random() * PLATES.zones.length)];
  const series = zone === 'Bagmati' ? PLATES.modernSeries : 1 + Math.floor(random() * PLATES.zoneSeries);
  const code = spec.plateCode ?? 'Pa';
  const serial = String(1 + Math.floor(random() * PLATES.serials)).padStart(4, '0');
  return `${zone} ${series} ${code} ${serial}`;
}

function pickType(random, multiplier) {
  let pick = random() * (1 + (multiplier - 1) * TRANSIT_SHARE);
  for (const entry of TYPES) {
    pick -= entry[1].share * (entry[1].transit ? multiplier : 1);
    if (pick < 0) return entry;
  }
  return TYPES.at(-1);
}

function insertionIndex(lane, s) {
  let i = lane.vehicles.length;
  while (i && lane.vehicles[i - 1].s < s) i--;
  return i;
}

function fits(lane, s, vehicle, desired = DRIVER.minimumGap) {
  const i = insertionIndex(lane, s);
  const ahead = lane.vehicles[i - 1];
  const behind = lane.vehicles[i];
  return (!ahead || ahead.s - s >= (ahead.length + vehicle.length) / 2 + desired)
    && (!behind || s - behind.s >= (behind.length + vehicle.length) / 2 + desired);
}

function closestAhead(lane, s) {
  return lane.vehicles[insertionIndex(lane, s) - 1];
}

function insert(lane, vehicle, s) {
  vehicle.lane = lane;
  vehicle.s = s;
  lane.vehicles.splice(insertionIndex(lane, s), 0, vehicle);
}

function takeOut(vehicle) {
  const list = vehicle.lane.vehicles;
  list.splice(list.indexOf(vehicle), 1);
}

function changeLane(vehicle, lane, s) {
  vehicle.previousLane = vehicle.lane;
  vehicle.lateral = 0;
  takeOut(vehicle);
  insert(lane, vehicle, s);
}

function leaderDwelling(vehicle) {
  return vehicle?.stop && vehicle.stop.started !== null && !vehicle.stop.completed;
}

function frontGap(vehicle, leader, s = vehicle.s) {
  return leader ? leader.s - s - (leader.length + vehicle.length) / 2 : Infinity;
}

function movementFor(lane, vehicle) {
  const move = lane.moves[vehicle.turn];
  return vehicle.stop?.side === 'far' && vehicle.stop.lane
    ? move.variants[vehicle.stop.lane.index] : move;
}

function hasRightOfWay(move, signals, rules) {
  const free = move.turn === 'left' && move.from.index === 0 && rules.arms[move.arm].freeLeft;
  return !move.giveWay && (free || signals.green(move.arm));
}

function hasReceivingSpace(move, vehicle) {
  const exit = move.to;
  const obstruction = exit.vehicles.findIndex(queued => queued.stop?.lane === exit && !queued.stop.completed);
  // Keep enough room behind a far-side stop for vehicles already committed
  // to this exit. A bus only projects a stop onto the lane as it nears it.
  let storage = Infinity;
  if (obstruction >= 0) {
    const bus = exit.vehicles[obstruction];
    storage = bus.stop.s - bus.length / 2;
    for (let i = obstruction + 1; i < exit.vehicles.length; i++) {
      const queued = exit.vehicles[i];
      storage -= queued.length + queued.spec.gap;
    }
  }
  let reserved = 0;
  for (const feeder of exit.feeders) {
    for (const committed of feeder.vehicles) {
      reserved += committed.length + committed.spec.gap;
      if (committed.stop?.lane === exit && !committed.stop.completed
          && feeder.path.length - committed.s < DRIVER.laneChangeLookahead) {
        // The bus is counted in reserved, so measure to its front here.
        storage = Math.min(storage, committed.stop.s + committed.length / 2);
      }
    }
  }
  return storage - reserved >= vehicle.length + vehicle.spec.gap;
}

function canEnter(move, vehicle, signals, pedestrians, rules, gap) {
  if ((!move.giveWay && !hasRightOfWay(move, signals, rules)) || pedestrians.blocks(move.arm)) return false;
  if (!fits(move, 0, vehicle, gap) || !hasReceivingSpace(move, vehicle)) return false;
  // Parallel entry lanes (including the motorcycle filter) discharge together.
  // A split from the same lane still waits for its predecessor. The receiving
  // lane checks the physical merge gap when vehicles reach it.
  for (const conflict of move.conflicts) {
    const other = conflict.lane;
    const sameApproach = other.arm === move.arm;
    const tail = other.vehicles.at(-1);
    if (tail && (!sameApproach || other.from === move.from) && tail.s - tail.length / 2 < conflict.until) {
      const remaining = conflict.until - tail.s + tail.length / 2;
      const enteringTime = Math.max(0, conflict.from - vehicle.length / 2) / DRIVER.turnSpeed[move.turn];
      const margin = sameApproach ? DRIVER.divergeTimeMargin : DRIVER.crossingTimeMargin;
      if (tail.speed <= DRIVER.stoppedSpeed || remaining / tail.speed + margin >= enteringTime) return false;
    }
    if (move.giveWay && hasRightOfWay(other, signals, rules) && !pedestrians.blocks(other.arm)) {
      const approaching = other.from.vehicles[0];
      if (approaching && movementFor(other.from, approaching) === other
          && other.from.path.length - approaching.s <= approaching.length / 2
            + Math.max(approaching.speed, DRIVER.filterMaxSpeed) * DRIVER.priorityGap) return false;
    }
  }
  return true;
}

function idm(vehicle, desired, gap, leaderSpeed) {
  const { acceleration, braking, gap: standingGap } = vehicle.spec;
  const velocity = vehicle.speed;
  const closing = velocity - leaderSpeed;
  const headway = DRIVER.headway * (vehicle.type === 'motorcycle' ? SATURATION.motorcyclePcu : 1);
  const dynamicGap = standingGap + Math.max(0, velocity * headway + velocity * closing / (2 * Math.sqrt(acceleration * braking)));
  return Math.max(-DRIVER.hardBrake, acceleration * (1 - (velocity / desired) ** DRIVER.exponent
    - (dynamicGap / Math.max(DRIVER.minimumGap, gap)) ** 2));
}

export function createAgents(network, scenario, random, events, metrics) {
  const vehicles = [];
  const exitCounts = { north: 0, east: 0, south: 0, west: 0 };
  const bypassed = [];
  const tunnelPaths = tunnelRoutes(network);
  // Diagnostic categories partition the same person-seconds already counted by metrics.
  const delayCauses = { dwelling: 0, curbQueue: 0, signal: 0, pedestrian: 0, spillback: 0, merging: 0, following: 0 };
  const entries = ARM_IDS.map(arm => {
    const demand = scenario.demand[arm];
    const routes = network.arms[arm].incoming[0].moves;
    return {
      arm, demand,
      streams: TURN_IDS.map(turn => {
        const rate = routes[turn] ? (demand.movements[turn] ?? 0) / 3600 : 0;
        return { turn, rate, next: exponential(random, rate) };
      }),
      pending: [],
    };
  });
  const changes = [];
  const boundaries = [];
  const dwellers = [];
  const exited = [];
  const renderPosition = {};
  const oldPosition = {};
  const telemetry = { delays: 0, busDelays: 0, idleGrams: 0, spillback: 0 };
  let nextId = 0;
  let pending = 0;

  function spawn(time, rules) {
    pending = 0;
    for (const entry of entries) {
      const arm = network.arms[entry.arm];
      for (const stream of entry.streams) {
        while (stream.next <= time) {
          const [type, spec] = pickType(random, entry.demand.transitMultiplier ?? 1);
          const vehicle = {
            id: ++nextId, type, spec, length: spec.length, occupancy: spec.occupancy, discipline: spec.discipline,
            maxSpeed: spec.speed * scenario.speed, arm: arm.id, turn: stream.turn, plate: nepaliPlate(random, spec),
            spawnedAt: null, arrivedAt: stream.next, delay: 0, speed: 0, s: 0, x: 0, z: 0, heading: 0,
            lane: null, laneId: null, lateral: 1, previousLane: null, preferredInside: random() < 0.5,
            destination: arm.incoming[0].moves[stream.turn].to.arm,
          };
          vehicle.stop = transitTraits(random, vehicle, entry.demand);
          vehicle.noLateMerge = rules.laneDiscipline;
          if (rules.gradeSeparation && TOOLS.gradeSeparation.corridor.some(([a, t]) => a === arm.id && t === stream.turn)) {
            vehicle.spawnedAt = stream.next;
            const speed = Math.min(vehicle.maxSpeed, TUNNEL_SPEED);
            metrics.spawn(vehicle);
            bypassed.push({ vehicle, speed, end: stream.next + tunnelPaths[arm.id].length / speed });
          } else entry.pending.push(vehicle);
          stream.next += exponential(random, stream.rate);
        }
      }
      for (let i = 0; i < entry.pending.length;) {
        const vehicle = entry.pending[i];
        if (vehicle.stop) planStop(vehicle, network, rules, scenario);
        const curb = arm.incoming[0];
        const inner = arm.incoming.at(-1);
        const inside = vehicle.turn === 'right' || (vehicle.turn === 'through'
          && (rules.arms[arm.id].channelizedLeft || (arm.id === 'east' && vehicle.preferredInside)));
        const nearStop = vehicle.stop?.side === 'near' && vehicle.stop.lane;
        const preferred = nearStop || !inside ? curb : inner;
        const s = vehicle.length / 2;
        const other = preferred === curb ? inner : curb;
        const lane = fits(preferred, s, vehicle, vehicle.spec.gap) ? preferred
          : !nearStop && fits(other, s, vehicle, vehicle.spec.gap) ? other : null;
        if (!lane) {
          i++;
          continue;
        }
        entry.pending.splice(i, 1);
        vehicle.spawnedAt = time;
        vehicle.speed = Math.min(vehicle.maxSpeed, lane.vehicles.at(-1)?.speed ?? vehicle.maxSpeed);
        insert(lane, vehicle, s);
        vehicles.push(vehicle);
        metrics.spawn(vehicle);
      }
      pending += entry.pending.length;
    }
  }

  function considerLaneChange(vehicle, leader, signals) {
    const lane = vehicle.lane;
    const road = network.arms[vehicle.arm];
    const remaining = lane.path.length - vehicle.s;
    if (lane.kind === 'outgoing') {
      const scheduledStop = vehicle.stop?.lane === lane && !vehicle.stop.completed;
      if (!vehicle.previousLane && !scheduledStop && network.arms[lane.arm].outgoing.length > 1
          && leader?.speed < DRIVER.filterStartSpeed && frontGap(vehicle, leader) < DRIVER.laneChangeLookahead) {
        changes.push(vehicle);
      }
      return;
    }
    if (lane.kind === 'bay' && vehicle.stop.completed) {
      changes.push(vehicle);
      return;
    }
    // Lane discipline: through traffic may not weave in the last metres before the stop line;
    // turning vehicles still take their turn lane (they are expected to have merged upstream).
    if (vehicle.noLateMerge && vehicle.turn === 'through' && lane.kind === 'incoming'
        && remaining < TOOLS.laneDiscipline.mergeZone && !(vehicle.stop && !vehicle.stop.completed)) return;
    if (vehicle.previousLane || !road.filter
        || (lane.kind !== 'incoming' && lane.kind !== 'filter')
        || remaining <= vehicle.length || vehicle.s < vehicle.length) return;
    if (vehicle.stop?.side === 'near' && vehicle.stop.lane && !vehicle.stop.completed) {
      if (lane !== vehicle.stop.lane) changes.push(vehicle);
      return;
    }
    const near = frontGap(vehicle, leader) < DRIVER.laneChangeLookahead;
    const congested = near && leader.speed < DRIVER.filterStartSpeed;
    if (lane.kind === 'filter' || congested || (near && leader.speed < vehicle.maxSpeed * (1 - vehicle.discipline))
        || (vehicle.turn === 'left' && lane.index !== 0 && remaining < DRIVER.laneChangeLookahead && !signals.green(vehicle.arm))) {
      changes.push(vehicle);
    }
  }

  function resolveLaneChange(vehicle) {
    const lane = vehicle.lane;
    const road = network.arms[vehicle.arm];
    const remaining = lane.path.length - vehicle.s;
    const sAt = target => target.path.length - remaining;
    if (lane.kind === 'outgoing') {
      const alternate = network.arms[lane.arm].outgoing[lane.index === 0 ? 1 : 0];
      const s = sAt(alternate);
      const ahead = frontGap(vehicle, closestAhead(alternate, s), s);
      const current = frontGap(vehicle, closestAhead(lane, vehicle.s + DRIVER.minimumGap));
      if (s >= vehicle.length / 2 && ahead >= current + DRIVER.laneChangeGain
          && fits(alternate, s, vehicle, vehicle.spec.gap)) changeLane(vehicle, alternate, s);
      return;
    }
    if (lane.kind === 'bay') {
      const target = road.incoming[0];
      const s = sAt(target);
      // Buses leaving a bay nose back into slow traffic (assumed: minimum safe gap, not the free-flow gap).
      if (fits(target, s, vehicle, DRIVER.minimumGap)) changeLane(vehicle, target, s);
      return;
    }
    const stop = vehicle.stop;
    if (stop?.side === 'near' && stop.lane && !stop.completed) {
      const s = sAt(stop.lane);
      if (s <= stop.s && fits(stop.lane, s, vehicle, vehicle.spec.gap)) changeLane(vehicle, stop.lane, s);
      return;
    }
    const gap = frontGap(vehicle, closestAhead(lane, vehicle.s + DRIVER.minimumGap));
    const other = road.incoming[lane.index === 0 ? 1 : 0];
    if (lane.kind === 'filter') {
      const target = vehicle.turn === 'right' ? road.incoming.at(-1) : road.incoming[0];
      const s = sAt(target);
      if (fits(target, s, vehicle, vehicle.spec.gap)
          && frontGap(vehicle, closestAhead(target, s), s) >= gap + DRIVER.laneChangeGain) changeLane(vehicle, target, s);
      return;
    }
    const s = sAt(other);
    const desired = vehicle.spec.gap + vehicle.speed * vehicle.discipline * DRIVER.headway;
    const needsLeft = vehicle.turn === 'left' && lane.index !== 0 && remaining < DRIVER.laneChangeLookahead;
    const blockedCurb = leaderDwelling(closestAhead(lane, vehicle.s + DRIVER.minimumGap));
    const separated = vehicle.turn === 'right' || (vehicle.turn === 'through' && road.id !== 'east');
    if ((!separated || needsLeft || blockedCurb) && s > vehicle.length / 2 && fits(other, s, vehicle, desired)
        && (needsLeft || frontGap(vehicle, closestAhead(other, s), s) >= gap + DRIVER.laneChangeGain)) {
      changeLane(vehicle, other, s);
      return;
    }
    if (vehicle.type === 'motorcycle' && remaining <= DRIVER.filterApproach && vehicle.speed <= DRIVER.filterMaxSpeed) {
      const position = sAt(road.filter);
      if (fits(road.filter, position, vehicle, vehicle.spec.gap)) changeLane(vehicle, road.filter, position);
    }
  }

  function render(vehicle, dt) {
    const path = vehicle.lane.path;
    sample(path, vehicle.s, renderPosition);
    if (vehicle.previousLane) {
      vehicle.lateral = Math.min(1, vehicle.lateral + dt * DRIVER.laneChangeSpeed);
      const progress = vehicle.lateral;
      const older = vehicle.previousLane.path;
      sample(older, older.length - (path.length - vehicle.s), oldPosition);
      renderPosition.x = oldPosition.x + (renderPosition.x - oldPosition.x) * progress;
      renderPosition.z = oldPosition.z + (renderPosition.z - oldPosition.z) * progress;
      if (progress === 1) vehicle.previousLane = null;
    }
    vehicle.x = renderPosition.x;
    vehicle.z = renderPosition.z;
    vehicle.heading = renderPosition.heading;
    vehicle.laneId = vehicle.lane.id;
    vehicle.segment = vehicle.lane.kind;
  }

  return {
    vehicles, exitCounts, delayCauses, bypassed,
    get pending() { return pending; },
    update(time, dt, signals, pedestrians, rules) {
      spawn(time, rules);
      for (let i = bypassed.length - 1; i >= 0; i--) {
        const { vehicle, end } = bypassed[i];
        if (end > time) continue;
        metrics.exit(vehicle);
        exitCounts[vehicle.destination]++;
        bypassed.splice(i, 1);
      }
      changes.length = boundaries.length = dwellers.length = exited.length = 0;
      telemetry.delays = telemetry.busDelays = telemetry.idleGrams = telemetry.spillback = 0;
      for (const lane of network.lanes) {
        let leader;
        let blocker;
        let leaderCause;
        for (const vehicle of lane.vehicles) {
          const stop = vehicle.stop;
          const dwelling = stop && stop.started !== null && !stop.completed;
          let cruising = vehicle.maxSpeed;
          if (lane.kind === 'movement') cruising = Math.min(cruising, DRIVER.turnSpeed[vehicle.turn] * scenario.speed);
          let cause = 'following';
          if (dwelling || lane.kind === 'bay') {
            vehicle.speed = 0;
            cause = dwelling ? 'dwelling' : 'merging';
            if (dwelling) {
              stop.affectedThisTick = false;
              stop.remaining = Math.max(0, stop.remaining - dt);
              if (stop.remaining === 0) endDwell(vehicle, time, network.arms[stop.lane.arm], events);
              else if (lane.kind !== 'bay') blocker = vehicle;
            }
          } else {
            let limit = lane.path.length;
            let desired = lane.kind === 'filter' ? Math.min(cruising, DRIVER.filterMaxSpeed) : cruising;
            let gap = frontGap(vehicle, leader);
            let leaderSpeed = leader?.speed ?? desired;
            let blockedExit = false;
            if (lane.kind === 'incoming' || lane.kind === 'filter') {
              const move = movementFor(lane, vehicle);
              const tail = move.vehicles.at(-1);
              const entryGap = tail ? lane.path.length - vehicle.s + tail.s - (tail.length + vehicle.length) / 2 : Infinity;
              if (entryGap < gap) {
                gap = entryGap;
                leaderSpeed = tail.speed;
              }
              const brakingDistance = desired * desired / (2 * vehicle.spec.braking);
              if (lane.path.length - vehicle.s <= brakingDistance + vehicle.length / 2 + desired * dt
                  && !canEnter(move, vehicle, signals, pedestrians, rules, DRIVER.minimumGap)) {
                limit -= vehicle.length / 2;
                if (!move.giveWay && !hasRightOfWay(move, signals, rules)) cause = 'signal';
                else if (pedestrians.blocks(move.arm)) cause = 'pedestrian';
                else if (!hasReceivingSpace(move, vehicle)) cause = 'spillback';
                else cause = 'merging';
              }
            } else if (lane.kind === 'movement') {
              const tail = lane.to.vehicles.at(-1);
              const exitGap = tail ? lane.path.length - vehicle.s + tail.s - (tail.length + vehicle.length) / 2 : Infinity;
              if (exitGap < gap) {
                gap = exitGap;
                leaderSpeed = tail.speed;
              }
              blockedExit = !fits(lane.to, 0, vehicle);
              // A moving exit tail is handled by car-following. Only a stopped
              // tail requires braking short of the boundary.
              const crossing = pedestrians.blocks(lane.to.arm, 'outgoing');
              if (crossing || (blockedExit && tail.speed <= DRIVER.stoppedSpeed)) {
                limit -= vehicle.length / 2;
                cause = crossing ? 'pedestrian' : 'spillback';
              }
            }
            if (stop?.lane === lane && !stop.completed && stop.started === null) limit = Math.min(limit, stop.s);
            if (limit < lane.path.length) desired = Math.min(desired, rampUp(vehicle.spec.braking, limit - vehicle.s));
            const speed = desired > DRIVER.stoppedSpeed
              ? Math.min(desired, Math.max(0, vehicle.speed + idm(vehicle, desired, gap, leaderSpeed) * dt))
              : desired;
            const realLimit = Math.min(limit, leader ? leader.s - (leader.length + vehicle.length) / 2 - DRIVER.minimumGap : Infinity);
            const advance = Math.max(0, Math.min(speed * dt, realLimit - vehicle.s));
            vehicle.s += advance;
            vehicle.speed = advance / dt;
            if (blockedExit && !leader && vehicle.speed <= DRIVER.stoppedSpeed
                && lane.path.length - vehicle.s <= vehicle.length / 2 + DRIVER.minimumGap) telemetry.spillback += dt;
            if (canBoard(vehicle)) dwellers.push(vehicle);
            else if (vehicle.s >= lane.path.length) {
              // A short final step at a lane boundary does not imply braking.
              vehicle.boundarySpeed = speed;
              boundaries.push(vehicle);
            }
            if (blocker && vehicle.speed < cruising && gap < DRIVER.laneChangeLookahead) {
              cause = 'curbQueue';
              const blockingStop = blocker.stop;
              blockingStop.affectedThisTick = true;
              blockingStop.delayedVehicles.add(vehicle.id);
              const seconds = dt * (1 - vehicle.speed / cruising);
              blockingStop.delayedSeconds += seconds;
              if (lane.kind === 'outgoing' || signals.green(vehicle.arm)) blockingStop.greenDelayedSeconds += seconds;
            } else if (cause === 'following' && leader && gap < DRIVER.laneChangeLookahead && leader.speed < cruising) {
              cause = leaderCause === 'dwelling' ? 'curbQueue' : leaderCause;
            }
          }
          const delay = dt * Math.max(0, 1 - vehicle.speed / cruising);
          vehicle.delay += delay;
          telemetry.delays += delay * vehicle.occupancy;
          delayCauses[cause] += delay * vehicle.occupancy;
          if (vehicle.spec.transit) telemetry.busDelays += delay * vehicle.occupancy;
          if (vehicle.speed < DRIVER.stoppedSpeed) telemetry.idleGrams += vehicle.spec.idleGrams * dt;
          if (vehicle.s < lane.path.length) considerLaneChange(vehicle, leader, signals);
          leader = vehicle;
          leaderCause = cause;
        }
      }
      for (const vehicle of boundaries) {
        const lane = vehicle.lane;
        if (lane.kind === 'outgoing') {
          takeOut(vehicle);
          exited.push(vehicle);
          metrics.exit(vehicle);
          exitCounts[lane.arm]++;
        } else if (lane.kind === 'movement') {
          if (!pedestrians.blocks(lane.to.arm, 'outgoing') && fits(lane.to, 0, vehicle)) {
            takeOut(vehicle);
            insert(lane.to, vehicle, 0);
            vehicle.speed = vehicle.boundarySpeed;
            vehicle.previousLane = null;
          }
        } else {
          const move = movementFor(lane, vehicle);
          if (canEnter(move, vehicle, signals, pedestrians, rules, DRIVER.minimumGap)) {
            takeOut(vehicle);
            insert(move, vehicle, 0);
            vehicle.speed = Math.min(vehicle.boundarySpeed, DRIVER.turnSpeed[vehicle.turn] * scenario.speed);
            vehicle.previousLane = null;
          }
        }
      }
      for (const vehicle of dwellers) {
        const arm = network.arms[vehicle.arm];
        const stop = vehicle.stop;
        // A bay is ~30 m long (assumed): take the first free slot from the front. If it is
        // full, board in the running lane instead of waiting (waiting deadlocks the bay exit).
        if (stop.bay) {
          const slot = [0, 11, 22].map(offset => stop.distance + offset)
            .find(d => d < arm.bay.path.length && fits(arm.bay, arm.bay.path.length - d, vehicle));
          if (slot === undefined) stop.bay = false;
          else stop.distance = slot;
        }
        if (stop.bay) takeOut(vehicle);
        beginDwell(vehicle, time, scenario, network.arms[stop.lane.arm], events);
        if (stop.bay) {
          insert(arm.bay, vehicle, vehicle.s);
          vehicle.previousLane = null;
        }
        metrics.walk(stop.passengers, stop.walkingDistance);
      }
      for (const vehicle of changes) resolveLaneChange(vehicle);
      for (const vehicle of exited) {
        const index = vehicles.indexOf(vehicle);
        vehicles.splice(index, 1);
      }
      for (const vehicle of vehicles) render(vehicle, dt);
      return telemetry;
    },
    replan(rules) {
      for (const vehicle of vehicles) {
        if (vehicle.lane.kind === 'incoming' || vehicle.lane.kind === 'filter') planStop(vehicle, network, rules, scenario);
      }
    },
  };
}
