import { CLOCK, DRIVER, TRANSIT } from './params.js';
import { ARM_IDS } from './scenarios.js';

const byArm = () => Object.fromEntries(ARM_IDS.map(arm => [arm, 0]));
const bucket = () => ({
  spawned: 0, exited: 0, persons: 0, arrivalsByArm: byArm(), exitsByArm: byArm(),
  delay: 0, personDelay: 0, busPassengerDelay: 0, delays: [],
  // Curb blockage counts the junction influence area. Lane blockage includes all distances.
  // Spillback counts connector-seconds stopped at an occupied exit entrance.
  curbBlockedSeconds: 0, laneBlockedSeconds: 0, queuedBlockedSeconds: 0, spillbackSeconds: 0, blockedByArm: byArm(), laneBlockedByArm: byArm(),
  pedestrianWait: 0, pedestrianWaitSeconds: 0, pedestriansCrossed: 0, unsafeCrossings: 0,
  addedWalkingDistance: 0, busUsersWalking: 0, idleCO2Kg: 0, costSpent: 0,
});

function summarize(data, seconds) {
  const rate = seconds > 0 ? 3600 / seconds : 0;
  const ordered = data.delays.slice().sort((a, b) => a - b);
  return {
    seconds, spawned: data.spawned, exited: data.exited, persons: data.persons,
    vehiclesPerHour: data.exited * rate, personsPerHour: data.persons * rate,
    arrivalsPerHourByArm: Object.fromEntries(ARM_IDS.map(arm => [arm, data.arrivalsByArm[arm] * rate])),
    throughputByArm: Object.fromEntries(ARM_IDS.map(arm => [arm, data.exitsByArm[arm] * rate])),
    meanDelay: data.exited ? data.delay / data.exited : 0,
    p95Delay: ordered.length ? ordered[Math.ceil(ordered.length * 0.95) - 1] : 0,
    personDelay: data.personDelay, busPassengerDelay: data.busPassengerDelay,
    curbBlockedSeconds: data.curbBlockedSeconds, laneBlockedSeconds: data.laneBlockedSeconds,
    queuedBlockedSeconds: data.queuedBlockedSeconds, spillbackSeconds: data.spillbackSeconds, blockedByArm: { ...data.blockedByArm }, laneBlockedByArm: { ...data.laneBlockedByArm },
    meanPedestrianWait: data.pedestriansCrossed ? data.pedestrianWait / data.pedestriansCrossed : 0,
    pedestrianWaitSeconds: data.pedestrianWaitSeconds, pedestriansCrossed: data.pedestriansCrossed,
    unsafeCrossings: data.unsafeCrossings, addedWalkingDistance: data.addedWalkingDistance,
    meanAddedWalkingDistance: data.busUsersWalking ? data.addedWalkingDistance / data.busUsersWalking : 0,
    idleCO2Kg: data.idleCO2Kg, emissionsAreEstimated: true, costSpent: data.costSpent,
  };
}

export function createMetrics() {
  const totals = bucket();
  const queueByArm = byArm();
  const queueMetersByArm = byArm();
  const queueSample = byArm();
  const windows = [];
  let window = bucket();
  let time = 0;
  let start = 0;
  let startCost = 0;
  let active = 0;
  const both = [totals, window];
  const api = {
    queueByArm, queueMetersByArm, windows,
    get time() { return time; },
    get spawned() { return totals.spawned; },
    get exited() { return totals.exited; },
    get active() { return active; },
    get vehiclesPerHour() { return time ? totals.exited * 3600 / time : 0; },
    get personsPerHour() { return time ? totals.persons * 3600 / time : 0; },
    get meanDelay() { return totals.exited ? totals.delay / totals.exited : 0; },
    get p95Delay() { return summarize(totals, time).p95Delay; },
    get curbBlockedSeconds() { return totals.curbBlockedSeconds; },
    get laneBlockedSeconds() { return totals.laneBlockedSeconds; },
    get spillbackSeconds() { return totals.spillbackSeconds; },
    get queuedBlockedSeconds() { return totals.queuedBlockedSeconds; },
    get personDelay() { return totals.personDelay; },
    get busPassengerDelay() { return totals.busPassengerDelay; },
    get unsafeCrossings() { return totals.unsafeCrossings; },
    get pedestrianWaitSeconds() { return totals.pedestrianWaitSeconds; },
    get meanPedestrianWait() { return totals.pedestriansCrossed ? totals.pedestrianWait / totals.pedestriansCrossed : 0; },
    get addedWalkingDistance() { return totals.addedWalkingDistance; },
    get idleCO2Kg() { return totals.idleCO2Kg; },
    get costSpent() { return totals.costSpent; },
    get currentWindow() {
      const seconds = time - start;
      return { from: start, to: time, ...summarize(window, seconds),
        queueByArm: { ...queueByArm },
        meanQueueByArm: Object.fromEntries(ARM_IDS.map(arm => [arm, seconds ? queueSample[arm] / seconds : 0])) };
    },
    spawn(vehicle) {
      for (const data of both) {
        data.spawned++;
        data.arrivalsByArm[vehicle.arm]++;
      }
    },
    exit(vehicle) {
      for (const data of both) {
        data.exited++;
        data.exitsByArm[vehicle.arm]++;
        data.persons += vehicle.occupancy;
        data.delay += vehicle.delay;
        data.delays.push(vehicle.delay);
      }
    },
    pedestrian(wait, unsafe) {
      for (const data of both) {
        data.pedestrianWait += wait;
        data.pedestriansCrossed++;
        if (unsafe) data.unsafeCrossings++;
      }
    },
    pedestrianWaiting(seconds) {
      for (const data of both) data.pedestrianWaitSeconds += seconds;
    },
    walk(passengers, addedDistance) {
      for (const data of both) {
        data.addedWalkingDistance += passengers * addedDistance;
        data.busUsersWalking += passengers;
      }
    },
    costs(cost) {
      totals.costSpent = cost;
      window.costSpent = cost - startCost;
    },
    tick(dt, now, network, vehicles, delays, busDelays, idleGrams, spillback, inTunnel = 0) {
      time = now;
      active = vehicles.length + inTunnel;
      for (const arm of ARM_IDS) {
        const road = network.arms[arm];
        let queue = 0;
        let metres = 0;
        for (const lane of road.incoming) {
          for (const vehicle of lane.vehicles) {
            if (vehicle.speed > DRIVER.stoppedSpeed) continue;
            queue++;
            metres = Math.max(metres, lane.path.length - vehicle.s + vehicle.length / 2);
          }
        }
        if (road.filter) {
          for (const vehicle of road.filter.vehicles) {
            if (vehicle.speed > DRIVER.stoppedSpeed) continue;
            queue++;
            metres = Math.max(metres, road.filter.path.length - vehicle.s + vehicle.length / 2);
          }
        }
        queueByArm[arm] = queue;
        queueMetersByArm[arm] = metres;
        queueSample[arm] += queue * dt;
        for (const lane of road.roadLanes) {
          let blocked = false;
          let junction = false;
          let queued = false;
          for (const vehicle of lane.vehicles) {
            const stop = vehicle.stop;
            if (!stop || stop.started === null || stop.completed) continue;
            blocked = true;
            junction ||= stop.distance <= TRANSIT.junctionInfluence;
            queued ||= stop.affectedThisTick;
          }
          if (blocked) {
            for (const data of both) {
              data.laneBlockedSeconds += dt;
              data.laneBlockedByArm[arm] += dt;
              if (queued) data.queuedBlockedSeconds += dt;
              if (junction) {
                data.curbBlockedSeconds += dt;
                data.blockedByArm[arm] += dt;
              }
            }
          }
        }
      }
      for (const data of both) {
        data.spillbackSeconds += spillback;
        data.personDelay += delays;
        data.busPassengerDelay += busDelays;
        data.idleCO2Kg += idleGrams / 1000;
      }
      if (time - start >= CLOCK.window) {
        windows.push(api.currentWindow);
        start = time;
        startCost = totals.costSpent;
        both[1] = window = bucket();
        for (const arm of ARM_IDS) queueSample[arm] = 0;
      }
    },
    snapshot() {
      return { ...summarize(totals, time), active, queueByArm: { ...queueByArm }, queueMetersByArm: { ...queueMetersByArm },
        currentWindow: api.currentWindow, windows: structuredClone(windows) };
    },
  };
  return api;
}
