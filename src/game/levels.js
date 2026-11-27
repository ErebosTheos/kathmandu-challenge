import { createSimulation } from '../sim/simulation.js';
import { ARM_IDS, SCENARIOS } from '../sim/scenarios.js';
import { CLOCK } from '../sim/params.js';
import { ARM, VEHICLE } from './tools.js';
import { PLANS } from './plans.js';

const conditionInfo = {
  morning: 'Weekday commuter peak. Buses and microbuses board at the curb on Ring Road.',
  busBunching: 'Frequent Sajha buses and microbuses arrive together at the north stop.',
  rain: 'Monsoon rain: lower speeds and longer boarding on every approach.',
  dashain: 'Dashain holiday exodus: heavy traffic heading east toward Bhaktapur.',
  sandbox: 'Light off-peak traffic. Useful to see how a change behaves without congestion.',
};
// Traffic conditions to test a plan against. No budgets, goals or scores: the simulator
// runs today's junction and the planned junction on identical traffic and reports time saved.
export const LEVELS = Object.values(SCENARIOS).map((scenario, index) => ({
  ...scenario, budget: Infinity, index, description: conditionInfo[scenario.id], seed: 235,
}));

const metricFrame = (m, t) => ({
  time: t, persons: t ? m.personsPerHour * t / 3600 : 0, delay: m.personDelay,
  blocked: m.curbBlockedSeconds, unsafe: m.unsafeCrossings,
});
const totalQueue = m => ARM_IDS.reduce((sum, arm) => sum + m.queueMetersByArm[arm], 0);

export function tell(event, network) {
  const { type, arm, distance, plate, vehicleType } = event;
  const road = ARM[arm];
  const lane = network.lanes[event.laneId];
  const vehicle = VEHICLE[vehicleType] + ' ' + plate;
  const site = Math.round(distance) + ' m ' + (event.side === 'far' ? 'past the exit entrance' : 'before the stop line');
  if (type === 'curb-blockage') {
    const green = Math.round(event.greenVehicleSecondsLost);
    const lost = event.vehiclesLost;
    return vehicle + ' dwelled for ' + Math.round(event.duration) + ' s on ' + road + ', ' + site + '. Lane ' + ((lane?.index ?? 0) + 1) + ' held up ' + lost + ' ' + (lost === 1 ? 'vehicle' : 'vehicles') + (green ? ' (' + green + ' vehicle-seconds during discharge)' : '') + '.';
  }
  if (type === 'transit-dwell-started' && event.blocking) return vehicle + ' is boarding on ' + road + ', ' + site + '. It will occupy the lane for about ' + Math.round(event.plannedDuration) + ' s.';
  if (type === 'transit-dwell-ended') return vehicle + ' boarded ' + event.passengers + ' passengers in the bus bay on ' + road + ' in ' + Math.round(event.duration) + ' s.';
  if (type === 'unsafe-crossing') return 'A pedestrian crossed against traffic on ' + road + ' after waiting ' + Math.round(event.wait) + ' s.';
  return '';
}

export function createRun(level) {
  // Three junctions on identical traffic (same seed): Now, Short-term, Long-term.
  const sims = PLANS.map(plan => {
    const sim = createSimulation({ scenario: level, seed: level.seed });
    for (const input of plan.inputs) sim.applyIntervention(input);
    return sim;
  });
  const [baseline] = sims;
  let view = 0;
  let charts = [[0, ...sims.map(() => 0)]];
  let chartInterval = 5;
  const advice = [];
  let speed = 0;
  let remainder = 0;
  let nextNoticeAt = 0;
  let latestConflict = null;
  function advise(message, time = sims[view].state.time) {
    advice.unshift({ message, time });
    if (advice.length > 12) advice.pop();
  }
  advise('Press Run to compare today’s junction, the short-term fixes, and the long-term tunnel on the same traffic.');
  sims.forEach((sim, index) => sim.events.subscribe(event => {
    if (index !== view) return;
    if (event.type === 'unsafe-crossing') latestConflict = event;
    const message = tell(event, sim.state.network);
    if (message && (event.time >= nextNoticeAt || event.type === 'unsafe-crossing')) {
      advise(PLANS[index].name + ': ' + message, event.time);
      nextNoticeAt = event.time + 5;
    }
  }));
  function makeReport() {
    return { elapsed: baseline.state.time, plans: PLANS.map((plan, i) => ({ plan, metrics: sims[i].metrics.snapshot(),
      causes: Object.entries(sims[i].state.delayCauses).sort((a, b) => b[1] - a[1]).slice(0, 3),
      ...savings(sims[i], baseline) })) };
  }
  return {
    sims, baseline, level, advice, advise, makeReport, plan: [], changes: [],
    get charts() { return charts; },
    get sim() { return sims[view]; },
    get view() { return view; },
    setView(index) { view = index; latestConflict = null; },
    get started() { return baseline.state.time > 0; },
    get speed() { return speed; },
    get fraction() { return Math.min(1, remainder / CLOCK.step); },
    get latestConflict() { return latestConflict; },
    setSpeed(value) { speed = value; },
    advance(seconds, beforeStep) {
      if (!speed) return;
      remainder += seconds * speed;
      while (remainder >= CLOCK.step) {
        remainder -= CLOCK.step;
        beforeStep?.(sims[view].state, baseline.state);
        for (const sim of sims) sim.step();
        const now = baseline.state.time;
        if (now % chartInterval === 0) {
          charts.push([now, ...sims.map(sim => totalDelay(sim.metrics) / 60)]);
          if (charts.length > 240) {
            charts = charts.filter((_, index) => index % 2 === 0);
            chartInterval *= 2;
          }
        }
      }
    },
  };
}

const totalDelay = m => m.personDelay + (m.pedestrianWaitSeconds ?? 0);

// Time saved by the plan against today's junction on identical traffic (same seed).
// personDelay counts every person in every vehicle, including trips still in progress.
export function savings(sim, baseline) {
  const a = sim.metrics, b = baseline.metrics;
  const elapsed = Math.max(1, sim.state.time);
  const baselineDelay = totalDelay(b);
  const personSeconds = baselineDelay - totalDelay(a);
  const people = Math.max(1, b.personsPerHour * elapsed / 3600);
  return {
    elapsed,
    personHoursSaved: personSeconds / 3600,
    secondsPerPerson: personSeconds / people,
    percentDelay: baselineDelay ? personSeconds / baselineDelay * 100 : 0,
    meanDelayChange: a.meanDelay - b.meanDelay,
    busPassengerHoursSaved: (b.busPassengerDelay - a.busPassengerDelay) / 3600,
    extraPeoplePerHour: a.personsPerHour - b.personsPerHour,
    // Rough scale-up, labelled as such in the UI: the same pattern held for a 2-hour peak.
    peakHoursSaved: personSeconds / 3600 * (7200 / Math.max(elapsed, 60)),
  };
}
