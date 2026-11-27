import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRun, LEVELS } from '../src/game/levels.js';
import { sample } from '../src/sim/geometry.js';
import { CLOCK, DRIVER, SATURATION, TOOLS } from '../src/sim/params.js';
import { ARM_IDS, SCENARIOS, SIGNAL_ARM_IDS, TURN_IDS, destinationFor } from '../src/sim/scenarios.js';
import { planStop } from '../src/sim/transit.js';
import { createSimulation } from '../src/sim/simulation.js';
import { sampleSkybridge, SKYBRIDGE, skybridgeRoute } from '../src/sim/skybridge.js';

const SEED = 235;
const RUN = CLOCK.levelDuration;
const TOLERANCE = 1e-6;
const rows = [];
const baselines = {};
let buildingCounts;

test('the comparison keeps running past the benchmark and only counts completed tunnel trips as exits', () => {
  const run = createRun(LEVELS[0]);
  run.setView(2);
  run.setSpeed(8);
  run.advance(1);
  const early = run.makeReport();
  assert.equal(early.elapsed, 8);
  assert.ok(run.sim.state.bypassed.length > 0);
  assert.equal(early.plans[2].metrics.exited, 0);

  run.advance(RUN / 8);
  const later = run.makeReport();
  assert.equal(later.elapsed, RUN + 8);
  assert.ok(run.sims.every(sim => sim.state.time === later.elapsed));
  const tunnel = later.plans[2].metrics;
  assert.ok(tunnel.exited > 0);
  assert.equal(tunnel.spawned, tunnel.exited + tunnel.active);
  assert.equal(tunnel.unsafeCrossings, 0);
  assert.equal(early.plans[2].metrics.exited, 0);

  run.setSpeed(0);
  run.advance(10);
  assert.equal(run.makeReport().elapsed, later.elapsed);
  run.setSpeed(1);
  run.advance(10);
  assert.equal(run.makeReport().elapsed, later.elapsed + 10);
});

test('the long-term plan routes pedestrians up and over the surface lanes', () => {
  const run = createRun(LEVELS[0]);
  run.setView(2);
  run.setSpeed(8);
  run.advance(10);
  const { state } = run.sim;
  const surface = run.baseline.state;
  for (const arm of SIGNAL_ARM_IDS) {
    const lane = state.pedestrians[arm];
    assert.equal(lane.waiting.length, 0);
    assert.ok(lane.crossing.length > 0 && lane.crossing.every(person => person.skybridge));
    assert.ok(surface.pedestrians[arm].crossing.every(person => !person.skybridge));
    const route = skybridgeRoute(state.network.arms[arm]);
    const person = lane.crossing[0];
    assert.ok(Math.abs(person.until - person.started - route.duration) < TOLERANCE);
    for (const forward of [true, false]) {
      assert.equal(sampleSkybridge(route, 0, forward, 0, {}).y, 0);
      assert.equal(sampleSkybridge(route, route.duration / 2, forward, 0, {}).y, SKYBRIDGE.height);
      assert.ok(Math.abs(sampleSkybridge(route, route.duration, forward, 0, {}).y) < TOLERANCE);
    }
  }
  assert.equal(run.sim.metrics.unsafeCrossings, 0);
});

function run(scenario, interventions = []) {
  const simulation = createSimulation({ scenario, seed: SEED, interventions });
  simulation.step(RUN);
  return simulation;
}

test('OSM provenance, clipping, buildings, and mapped approaches', async () => {
  const map = JSON.parse(await readFile(new URL('../data/koteshwor.geo.json', import.meta.url)));
  assert.deepEqual([map.origin.lat, map.origin.lon, map.origin.osmNodeId], [27.6786343, 85.3495325, 31228768]);
  assert.deepEqual(map.signals.find(marker => marker.id === map.origin.osmNodeId).point, [0, 0]);
  for (const feature of [...map.roads, ...map.footways]) {
    assert.ok(feature.points.every(point => Math.hypot(...point) <= 450.01));
  }
  for (const item of map.buildings) {
    assert.ok(item.levels > 0);
    for (const polygon of item.polygons) {
      for (const ring of polygon) assert.deepEqual(ring[0], ring.at(-1));
    }
  }
  buildingCounts = map.metadata.buildingCounts;
  assert.deepEqual(Object.values(buildingCounts).map(count => count.keptOSM), [329, 1, 178, 45]);
  for (const count of Object.values(buildingCounts)) assert.equal(count.rawWithin320m, count.keptOSM);
  const filler = map.buildings.filter(building => building.filler);
  assert.equal(filler.length, map.metadata.fillerBuildings);
  assert.ok(filler.length > 0);
  const fillerByQuadrant = Object.fromEntries(Object.keys(buildingCounts).map(key => [key, 0]));
  for (const building of filler) {
    assert.equal(building.source, 'procedural, not from OSM');
    assert.ok(building.id < 0);
    const ring = building.polygons[0][0].slice(0, -1);
    assert.ok(ring.every(([x, z]) => Math.hypot(x, z) < map.coordinates.buildingRadius));
    const [east, south] = ring.reduce(([x, z], [px, pz]) => [x + px, z + pz], [0, 0]);
    fillerByQuadrant[(south > 0 ? 'S' : 'N') + (east > 0 ? 'E' : 'W')]++;
  }
  assert.deepEqual(fillerByQuadrant, Object.fromEntries(Object.entries(buildingCounts).map(([key, count]) => [key, count.filler])));
  assert.equal(map.buildings.length, Object.values(buildingCounts).reduce((total, count) => total + count.keptOSM + count.filler, 0));
  assert.deepEqual(map.arms.map(arm => arm.ref), ['NH39', 'NH39', 'NH34', null]);
  assert.match(map.junctionNotes, /F86.*490 m/);
  const { state: { network } } = createSimulation();
  assert.deepEqual(network.arms.north.stops.map(({ osmId, side, assumed }) => [osmId, side, assumed]), [
    [4030822684, 'near', false], [3461553725, 'far', false],
  ]);
  assert.equal(network.arms.west.priority, 'give-way');
  for (const id of ['south', 'east', 'west']) assert.equal(network.arms[id].officialStop.assumed, true);
  for (const id of ARM_IDS) {
    const arm = network.arms[id];
    for (const lane of arm.incoming) {
      assert.deepEqual(Object.keys(lane.moves), TURN_IDS.filter(turn => destinationFor(id, turn)));
      for (const [turn, movement] of Object.entries(lane.moves)) {
        assert.equal(movement.to.arm, destinationFor(id, turn));
        assert.deepEqual(movement.path.points[0], lane.path.points.at(-1));
        assert.deepEqual(movement.path.points.at(-1), movement.to.path.points[0]);
        if (id === 'west' || movement.to.arm === 'west') {
          assert.ok(movement.path.points.some(point => point.every((value, i) => value === network.arms.west.junctionPoint[i])));
        }
      }
    }
  }
});

test('all five baseline scenarios conserve vehicles, remain on their paths and run within 3 CPU seconds each', () => {
  const order = ['north', 'south', 'east', 'west'];
  for (const [id, settings] of Object.entries(SCENARIOS)) {
    const cpu = process.cpuUsage();
    const simulation = createSimulation({ scenario: id, seed: SEED });
    const { metrics, state } = simulation;
    const rendered = {};
    const old = {};
    for (let t = 0; t < RUN; t += CLOCK.step) {
      simulation.step(CLOCK.step);
      assert.equal(metrics.spawned, metrics.exited + state.vehicles.length, id);
      for (const lane of state.network.lanes) {
        let leader;
        for (const vehicle of lane.vehicles) {
          assert.equal(vehicle.laneId, lane.id);
          assert.ok(vehicle.s >= -TOLERANCE && vehicle.s <= lane.path.length + TOLERANCE, id);
          if (leader) {
            const gap = leader.s - vehicle.s - (leader.length + vehicle.length) / 2;
            assert.ok(gap >= DRIVER.minimumGap - TOLERANCE, `${id} lane ${lane.id} gap ${gap} at ${state.time}`);
          }
          sample(lane.path, vehicle.s, rendered);
          if (vehicle.previousLane) {
            const previous = vehicle.previousLane.path;
            sample(previous, previous.length - (lane.path.length - vehicle.s), old);
            rendered.x = old.x + (rendered.x - old.x) * vehicle.lateral;
            rendered.z = old.z + (rendered.z - old.z) * vehicle.lateral;
          }
          assert.ok(Math.hypot(rendered.x - vehicle.x, rendered.z - vehicle.z) <= TOLERANCE, id);
          assert.ok(Number.isFinite(vehicle.heading), id);
          leader = vehicle;
        }
      }
    }
    const { user, system } = process.cpuUsage(cpu);
    assert.ok(user + system < 3e6, `${id} used ${((user + system) / 1e6).toFixed(3)} CPU seconds`);
    const result = metrics.snapshot();
    assert.equal(result.windows.length, 2);
    assert.ok(result.exited > 0 && result.personsPerHour > result.vehiclesPerHour);
    assert.ok(result.p95Delay >= result.meanDelay && result.meanDelay > 0);
    assert.equal(result.windows[0].exited + result.windows[1].exited, result.exited);
    const exitShare = result.exited / result.spawned;
    const queued = Object.values(result.queueByArm).reduce((total, count) => total + count, 0);
    if (id === 'morning') {
      assert.ok(exitShare >= 0.7, `Morning rush exit share was ${(exitShare * 100).toFixed(1)}%`);
      assert.ok(queued > 0, 'Morning rush should still have a visible queue');
    }
    baselines[id] = simulation;
    rows.push({
      Scenario: settings.name,
      'North veh/h': result.arrivalsPerHourByArm[order[0]],
      'South veh/h': result.arrivalsPerHourByArm[order[1]],
      'East veh/h': result.arrivalsPerHourByArm[order[2]],
      'West veh/h': result.arrivalsPerHourByArm[order[3]],
      'Exited / admitted': `${result.exited} / ${result.spawned}`,
      'Exit %': (exitShare * 100).toFixed(1),
      'Queued at end': queued,
      'Pending': state.pendingArrivals,
      'Mean delay s': result.meanDelay.toFixed(1),
      'Curb blocked s': result.curbBlockedSeconds.toFixed(1),
      'CPU s': ((user + system) / 1e6).toFixed(3),
    });
  }
});

test('fixed-step determinism across time chunk sizes, pause and playback rates', () => {
  const baseline = baselines.morning;
  const other = createSimulation({ scenario: 'morning', seed: SEED });
  other.setSpeed(0);
  other.step(11.7);
  assert.equal(other.state.tick, 0);
  other.setSpeed(8);
  for (let t = 0; t < RUN / 8; t++) other.step(1);
  assert.deepEqual(other.metrics.snapshot(), baseline.metrics.snapshot());
  assert.deepEqual(other.events.log, baseline.events.log);
  const third = createSimulation({ scenario: 'morning', seed: SEED + 1 });
  third.step(RUN);
  assert.notDeepEqual(third.metrics.snapshot(), baseline.metrics.snapshot());
});

test('dwell blocks the curb lane and the advisor event identifies the vehicle and loss', () => {
  const simulation = baselines.busBunching;
  const dwell = simulation.events.log.find(event => event.type === 'curb-blockage' && event.arm === 'north' && event.vehiclesLost > 0);
  assert.ok(dwell, 'a curb dwell should delay actual following vehicles');
  assert.match(dwell.plate, /^(Ba \d+|Bagmati 03-001) (Pa|Kha|Ha) \d{4}$/);
  assert.ok(dwell.vehicleId > 0 && dwell.duration > 0 && dwell.vehicleSecondsLost > 0);
  assert.ok(simulation.metrics.laneBlockedSeconds > 0 && simulation.metrics.queuedBlockedSeconds > 0);
});

test('both mapped stops serve vehicles travelling in their mapped direction', () => {
  const { events, state } = baselines.morning;
  const near = events.log.find(event => event.type === 'transit-dwell-started' && event.osmId === 4030822684);
  const far = events.log.find(event => event.type === 'transit-dwell-started' && event.osmId === 3461553725);
  assert.equal(near?.laneId, state.network.arms.north.incoming[0].id);
  assert.equal(far?.laneId, state.network.arms.north.outgoing[0].id);
});

test('delay scales with demand and stays under 25 s in near-empty traffic', () => {
  assert.ok(baselines.sandbox.metrics.meanDelay < baselines.morning.metrics.meanDelay);
  const base = SCENARIOS.sandbox;
  const demand = Object.fromEntries(ARM_IDS.map(arm => [arm, {
    ...base.demand[arm],
    movements: Object.fromEntries(TURN_IDS.map(turn => [turn, base.demand[arm].movements[turn] * 0.1])),
  }]));
  const { metrics, state } = run({ ...base, demand });
  assert.ok(metrics.exited >= 10 && metrics.exited / metrics.spawned >= 0.75);
  assert.equal(state.pendingArrivals, 0);
  assert.ok(metrics.meanDelay < 25, `near-empty mean delay was ${metrics.meanDelay.toFixed(1)} s`);
  rows.push({ Scenario: 'Near-empty Sandbox', 'Exited / admitted': `${metrics.exited} / ${metrics.spawned}`,
    'Exit %': (100 * metrics.exited / metrics.spawned).toFixed(1),
    'Queued at end': Object.values(metrics.queueByArm).reduce((total, count) => total + count, 0),
    Pending: state.pendingArrivals, 'Mean delay s': metrics.meanDelay.toFixed(1) });
});

test('Koteshwor is a three-arm junction: the Seti O.P. Marg link carries no modelled traffic', () => {
  const { state } = baselines.morning;
  assert.deepEqual(Object.keys(state.signal.plan.greens), SIGNAL_ARM_IDS);
  assert.ok(Object.values(SCENARIOS).every(settings => settings.demand.west.vehiclesPerHour === 0 && settings.demand.west.pedestriansPerHour === 0));
  assert.ok(state.vehicles.every(vehicle => vehicle.arm !== 'west'));
});

test('a stop can snap to any outgoing lane and undo restores its mapped site', () => {
  const sim = createSimulation({ scenario: 'sandbox', seed: SEED });
  for (const arm of ARM_IDS) {
    for (const lane of sim.state.network.arms[arm].outgoing) {
      const result = sim.applyIntervention({ type: 'moveStop', arm: 'north', exitArm: arm, laneIndex: lane.index, distance: 10 });
      assert.equal(result.ok, true);
      const stop = sim.state.rules.arms[arm].stops.find(site => site.osmId === 4030822684);
      assert.deepEqual([stop.side, stop.laneIndex, stop.assumed], ['far', lane.index, true]);
      const snapped = sample(lane.path, stop.distance);
      assert.deepEqual(stop.point, [snapped.x, snapped.z]);
      assert.ok(sim.removeIntervention(result.id));
      assert.equal(sim.state.rules.arms.north.stops.find(site => site.osmId === 4030822684).side, 'near');
    }
  }
});

test('a far-side dwell blocks its exit lane and queues vehicles inside the junction', () => {
  const base = SCENARIOS.busBunching;
  const demand = Object.fromEntries(ARM_IDS.map(arm => [arm, {
    ...base.demand[arm], pedestriansPerHour: 0, stopShare: arm === 'north' ? 1 : 0, transitMultiplier: 4,
    movements: { left: 0, through: arm === 'north' ? 1800 : 0, right: 0 },
  }]));
  const simulate = distance => {
    const sim = createSimulation({ seed: SEED, scenario: { ...base, demand, informal: 0 },
      interventions: [{ type: 'moveStop', arm: 'north', exitArm: 'east', laneIndex: 1, distance }] });
    const lane = sim.state.network.arms.east.outgoing[1];
    let exitQueue = false;
    let insideQueue = false;
    for (let t = 0; t < RUN; t += CLOCK.step) {
      sim.step(CLOCK.step);
      const bus = lane.vehicles.find(vehicle => vehicle.stop?.started != null && !vehicle.stop.completed);
      if (!bus) continue;
      exitQueue ||= lane.vehicles.some(vehicle => vehicle.s < bus.s && vehicle.speed <= DRIVER.stoppedSpeed);
      insideQueue ||= sim.state.network.movements.some(move => move.to === lane && move.vehicles.some(vehicle =>
        vehicle.s > 0 && vehicle.speed <= DRIVER.stoppedSpeed && move.path.length - vehicle.s < 10));
    }
    const dwell = sim.events.log.find(event => event.type === 'transit-dwell-started' && event.side === 'far');
    assert.equal(dwell?.laneId, lane.id);
    assert.equal(dwell?.blocking, true);
    assert.ok(sim.metrics.snapshot().laneBlockedByArm.east > 0);
    return { exitQueue, insideQueue, spillback: sim.metrics.spillbackSeconds };
  };
  const nearExit = simulate(8);
  assert.ok(nearExit.exitQueue && nearExit.insideQueue && nearExit.spillback > 0);
  const fartherAway = simulate(50);
  assert.ok(fartherAway.exitQueue);
  assert.ok(!fartherAway.insideQueue);
  assert.equal(fartherAway.spillback, 0);
});

test('moving a stop and building a bay preserve informal stopping propensity', () => {
  assert.deepEqual(Object.keys(TOOLS).filter(tool => 'compliance' in TOOLS[tool]),
    ['noStoppingZone', 'policeOfficer', 'infoCampaign']);
  const sim = createSimulation({ scenario: 'sandbox' });
  const settings = SCENARIOS.busBunching;
  const vehicle = { length: 4, arm: 'north', destination: 'east',
    stop: { started: null, informal: 0.5, informalDistance: 16 } };
  const plan = () => {
    planStop(vehicle, sim.state.network, sim.state.rules, settings);
    return vehicle.stop.distance;
  };
  assert.equal(plan(), 16);
  sim.applyIntervention({ type: 'moveStop', arm: 'north', distance: 50 });
  sim.applyIntervention({ type: 'busBay', arm: 'north' });
  sim.step(TOOLS.busBay.buildTime);
  assert.equal(plan(), 16);
  sim.applyIntervention({ type: 'infoCampaign' });
  sim.applyIntervention({ type: 'policeOfficer' });
  assert.equal(plan(), 50);
});

test('50 m relocation reduces junction blockage and adds bus-user walking', () => {
  const baseline = baselines.busBunching.metrics.snapshot();
  const moved = run('busBunching', [{ type: 'moveStop', arm: 'north', distance: 50 }]);
  const result = moved.metrics.snapshot();
  assert.equal(moved.state.rules.arms.north.stopDistance, 50);
  assert.ok(result.curbBlockedSeconds < baseline.curbBlockedSeconds * 0.9);
  assert.ok(result.laneBlockedSeconds >= result.curbBlockedSeconds);
  assert.ok(result.addedWalkingDistance > baseline.addedWalkingDistance);
  assert.ok(moved.events.log.some(e => e.type === 'transit-dwell-started' && e.distance === 50));
});

test('planned bus bay (active from 0:00) removes boarding blockage on its approach', () => {
  const bay = run('busBunching', [{ type: 'busBay', arm: 'north' }]);
  const starts = bay.events.log.filter(event => event.type === 'transit-dwell-started' && event.arm === 'north');
  assert.ok(starts.length > 0);
  // When the bay is full, vehicles board in the running lane (realistic overflow), so most, not all, use the bay.
  // Near the stop line a full bay cannot always empty into the queue, so only some buses use it.
  assert.ok(starts.some(event => event.blocking === false));
  assert.ok(bay.metrics.snapshot().laneBlockedByArm.north < baselines.busBunching.metrics.snapshot().laneBlockedByArm.north);
  assert.ok(bay.state.interventions.some(item => item.type === 'busBay' && item.active && item.readyAt === 0));
});

test('edited vehicle splits redistribute queues', () => {
  const before = baselines.busBunching.metrics.snapshot();
  const after = run('busBunching', [{ type: 'signalTiming', splits: { north: .65, south: .09, east: .20 } }]).metrics.snapshot();
  assert.ok(after.queueByArm.north < before.queueByArm.north);
  assert.ok(after.queueByArm.south > before.queueByArm.south);
  assert.ok(after.throughputByArm.north > before.throughputByArm.north);
});

test('long pedestrian waits increase unsafe crossing events', () => {
  const crosswalk = { type: 'pedestrianSignal', arm: 'north' };
  const quick = run('busBunching', [crosswalk, { type: 'signalTiming', cycle: 80, splits: { north: .15, east: .35, south: .35 } }]);
  const slow = run('busBunching', [crosswalk, { type: 'signalTiming', cycle: 220, splits: { north: .9, south: .03, east: .04 } }]);
  const conflicts = sim => sim.events.log.filter(e => e.type === 'unsafe-crossing' && e.arm === 'north');
  assert.ok(conflicts(slow).length > conflicts(quick).length);
  assert.ok(slow.metrics.meanPedestrianWait > quick.metrics.meanPedestrianWait);
});

test('tools apply, finish construction and undo with budget and manual police operation', () => {
  const simulation = createSimulation({ scenario: 'sandbox', seed: SEED });
  const zone = simulation.applyIntervention({ type: 'noStoppingZone', start: 5, length: 30 });
  const officer = simulation.applyIntervention({ type: 'policeOfficer', manual: true });
  const zebra = simulation.applyIntervention({ type: 'zebra', arm: 'south' });
  const freeLeft = simulation.applyIntervention({ type: 'freeLeft', arm: 'south' });
  const campaign = simulation.applyIntervention({ type: 'infoCampaign' });
  assert.ok([zone, officer, zebra, freeLeft, campaign].every(item => item.ok));
  const placedCost = simulation.metrics.costSpent;
  assert.equal(simulation.state.signal.plan.mode, 'manual');
  assert.equal(simulation.requestSignalPhase('east'), true);
  simulation.step(12);
  assert.ok(simulation.state.rules.arms.south.channelizedLeft);
  assert.ok(simulation.state.rules.arms.north.campaign > 0);
  assert.equal(simulation.state.rules.arms.south.crosswalk, 'zebra');
  assert.ok(simulation.metrics.costSpent > placedCost);
  assert.equal(simulation.state.signal.arm, 'east');
  assert.ok(simulation.removeIntervention(officer.id));
  assert.ok(simulation.removeIntervention(zone));
  assert.equal(simulation.state.signal.plan.mode, 'fixed');
  assert.deepEqual(simulation.state.rules.arms.north.zones, []);
  assert.equal(simulation.requestSignalPhase('east'), false);
  assert.equal(simulation.removeIntervention(zone.id), false);
});

process.on('exit', () => {
  console.log(`\nBaseline calibration for seed ${SEED}, ${RUN} simulated seconds. Arm rates count admitted vehicles.`);
  console.log(`Assumed dry saturation reference ${SATURATION.basePcuPerGreenLaneHour} PCU/h/green lane. Motorcycle weight ${SATURATION.motorcyclePcu} PCU.`);
  console.table(rows);
  console.log('Building counts by quadrant');
  if (buildingCounts) console.table(buildingCounts);
});
