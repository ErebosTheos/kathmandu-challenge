import { createAgents } from './agents.js';
import { createEvents } from './events.js';
import { createInterventions } from './interventions.js';
import { createMetrics } from './metrics.js';
import { createNetwork } from './network.js';
import { CLOCK } from './params.js';
import { createPedestrians } from './pedestrians.js';
import { createRng } from './rng.js';
import { getScenario } from './scenarios.js';
import { createSignals } from './signals.js';

export function createSimulation({ scenario = 'morning', seed = 1, interventions = [] } = {}) {
  const settings = getScenario(scenario);
  const random = createRng(seed);
  const trafficRandom = createRng(random() * 4294967296);
  const pedestrianRandom = createRng(random() * 4294967296);
  const signalRandom = createRng(random() * 4294967296);
  const pedestrianBehavior = createRng(random() * 4294967296);
  const network = createNetwork();
  const metrics = createMetrics();
  const events = createEvents();
  const signals = createSignals(signalRandom);
  const pedestrians = createPedestrians(network, settings, pedestrianRandom, pedestrianBehavior, events, metrics);
  const agents = createAgents(network, settings, trafficRandom, events, metrics);
  let remainder = 0;
  const state = {
    time: 0, tick: 0, speed: 1, scenario: settings.id, network, vehicles: agents.vehicles,
    pedestrians: pedestrians.state, signal: signals.state, interventions: [], pendingArrivals: 0,
    costSpent: 0, budgetRemaining: settings.budget,
    delayCauses: agents.delayCauses, exitCounts: agents.exitCounts, bypassed: agents.bypassed,
  };
  const policy = createInterventions(network, settings.budget, events, rules => {
    signals.configure(rules.signal, metrics.queueByArm);
    agents.replan(rules);
  });
  state.interventions = policy.placements;
  state.rules = policy.rules;

  function syncCosts() {
    state.costSpent = policy.rules.costSpent;
    state.budgetRemaining = policy.rules.budgetRemaining;
    metrics.costs(state.costSpent);
  }

  const api = {
    state,
    metrics,
    events,
    step(dt = CLOCK.step) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Elapsed time must be a finite, nonnegative number');
      remainder += dt * state.speed;
      while (remainder + Number.EPSILON * 8 >= CLOCK.step) {
        remainder = Math.max(0, remainder - CLOCK.step);
        state.time = ++state.tick * CLOCK.step;
        policy.update(CLOCK.step, state.time);
        signals.update(CLOCK.step, metrics.queueByArm);
        pedestrians.update(state.time, CLOCK.step, signals, policy.rules);
        const activity = agents.update(state.time, CLOCK.step, signals, pedestrians, policy.rules);
        state.pendingArrivals = agents.pending;
        syncCosts();
        metrics.tick(CLOCK.step, state.time, network, state.vehicles, activity.delays, activity.busDelays, activity.idleGrams, activity.spillback, agents.bypassed.length);
      }
      return state;
    },
    setSpeed(speed) {
      if (!CLOCK.speeds.includes(speed)) throw new RangeError('Playback speed must be 0, 1, 2, 4, or 8');
      state.speed = speed;
    },
    requestSignalPhase: signals.requestPhase,
    applyIntervention(input) {
      const result = policy.apply(input, state.time);
      syncCosts();
      return result;
    },
    removeIntervention(id) {
      const result = policy.remove(id, state.time);
      syncCosts();
      return result;
    },
    snapshot() {
      return {
        time: state.time, tick: state.tick, speed: state.speed, scenario: state.scenario, seed,
        vehicles: state.vehicles.map(vehicle => ({
          id: vehicle.id, type: vehicle.type, plate: vehicle.plate, arm: vehicle.arm, turn: vehicle.turn, destination: vehicle.destination,
          x: vehicle.x, z: vehicle.z, heading: vehicle.heading, speed: vehicle.speed, delay: vehicle.delay,
          length: vehicle.length, laneId: vehicle.laneId, segment: vehicle.segment, s: vehicle.s,
          stop: vehicle.stop ? { distance: vehicle.stop.distance, side: vehicle.stop.side, stopLaneId: vehicle.stop.lane?.id ?? null, remaining: vehicle.stop.remaining, bay: vehicle.stop.bay,
            started: vehicle.stop.started, completed: vehicle.stop.completed } : null,
        })),
        pedestrians: structuredClone(state.pedestrians), signal: structuredClone(state.signal),
        interventions: structuredClone(state.interventions), budgetRemaining: state.budgetRemaining,
        pendingArrivals: state.pendingArrivals, metrics: metrics.snapshot(), events: structuredClone(events.log),
      };
    },
  };
  for (const intervention of interventions) {
    const result = api.applyIntervention(intervention);
    if (!result.ok) throw new RangeError(result.reason);
  }
  return api;
}
