import { DRIVER, PED } from './params.js';
import { exponential } from './rng.js';
import { ARM_IDS, SIGNAL_ARM_IDS } from './scenarios.js';
import { skybridgeRoute } from './skybridge.js';

export function createPedestrians(network, scenario, arrivals, behavior, events, metrics) {
  const bridges = Object.fromEntries(SIGNAL_ARM_IDS.map(arm => [arm, skybridgeRoute(network.arms[arm])]));
  const lanes = Object.fromEntries(ARM_IDS.map(arm => [arm, {
    id: arm,
    osmId: network.arms[arm].crossing.osmId,
    point: network.arms[arm].crossing.point,
    length: network.arms[arm].crossing.length,
    rate: scenario.demand[arm].pedestriansPerHour / 3600,
    next: exponential(arrivals, scenario.demand[arm].pedestriansPerHour / 3600),
    waiting: [], crossing: [],
  }]));
  let nextId = 0;
  let now = 0;
  return {
    state: lanes,
    update(time, dt, signals, rules) {
      now = time;
      for (const arm of ARM_IDS) {
        const lane = lanes[arm];
        while (lane.next <= time) {
          lane.waiting.push({ id: ++nextId, arrived: lane.next, patience: PED.patience + PED.patienceSpread * arrivals() });
          lane.next += exponential(arrivals, lane.rate);
        }
        for (let i = lane.crossing.length - 1; i >= 0; i--) {
          if (lane.crossing[i].until <= time) lane.crossing.splice(i, 1);
        }
        const bridge = rules.skybridge ? bridges[arm] : null;
        if (bridge || rules.underpass) {
          const duration = bridge?.duration ?? (lane.length + 8) / PED.crossingSpeed;
          for (const person of lane.waiting) {
            lane.crossing.push({ ...person, started: time, until: time + duration,
              incomingFirst: person.id % 2 === 0, skybridge: Boolean(bridge), underpass: !bridge });
            metrics.pedestrian(time - person.arrived, false);
          }
          lane.waiting.length = 0;
          continue;
        }
        const signal = signals.state;
        const mode = rules.arms[arm].crosswalk;
        const walk = SIGNAL_ARM_IDS.includes(arm) && signal.stage === 'green' && signal.arm !== arm && signal.remaining >= lane.length / PED.crossingSpeed;
        const road = network.arms[arm];
        let nearest = Infinity;
        for (const approach of road.incoming) {
          const vehicle = approach.vehicles[0];
          if (!vehicle) continue;
          const freeLeft = vehicle.turn === 'left' && approach.index === 0 && rules.arms[arm].freeLeft;
          if (signals.green(arm) || freeLeft || road.priority === 'give-way') {
            nearest = Math.min(nearest, (approach.path.length - vehicle.s) / Math.max(DRIVER.filterMaxSpeed, vehicle.speed));
          }
        }
        for (const movement of road.crossing.approaching) {
          const front = movement.vehicles[0];
          if (front) nearest = Math.min(nearest, (movement.path.length - front.s) / Math.max(PED.crossingSpeed, front.speed));
        }
        for (const exit of road.outgoing) {
          const near = exit.vehicles.at(-1);
          if (near && near.s < PED.crosswalkGap) nearest = 0;
        }
        for (let i = 0; i < lane.waiting.length;) {
          const person = lane.waiting[i];
          const wait = time - person.arrived;
          const safe = mode === 'signal' && SIGNAL_ARM_IDS.includes(arm) ? walk : nearest >= PED.safeGap || (mode === 'zebra'
            && wait >= PED.maxYieldWait && behavior() < PED.zebraYield);
          const unsafe = !rules.guardrails && !safe && wait >= person.patience && behavior() < PED.impatienceRate * dt;
          if (!safe && !unsafe) {
            i++;
            continue;
          }
          lane.waiting.splice(i, 1);
          lane.crossing.push({ ...person, started: time, until: time + lane.length / PED.crossingSpeed,
            incomingFirst: person.id % 2 === 0, unsafe });
          metrics.pedestrian(wait, unsafe);
          if (unsafe) events.emit('unsafe-crossing', time, { arm, pedestrianId: person.id, wait, crossingMode: mode });
        }
        metrics.pedestrianWaiting(lane.waiting.length * dt);
      }
    },
    blocks(arm, direction = 'incoming') {
      // Assumed equal curb demand and half the crossing time per carriageway.
      // Seti is undivided, so a pedestrian occupies the full roadway there.
      return lanes[arm].crossing.some(person => {
        if (person.underpass || person.skybridge) return false;
        if (arm === 'west') return true;
        const firstHalf = now - person.started < (person.until - person.started) / 2;
        const inIncoming = firstHalf === person.incomingFirst;
        return direction === 'incoming' ? inIncoming : !inIncoming;
      });
    },
  };
}
