// Averages Now / Short-term / Long-term and each individual measure over several traffic
// samples (seeds) per condition, so results are not one lucky run. Writes data/measure-effects.json.
import { writeFileSync } from 'node:fs';
import { createSimulation } from '../src/sim/simulation.js';
import { LEVELS } from '../src/game/levels.js';
import { PLANS } from '../src/game/plans.js';

const SEEDS = [235, 11, 42, 97, 503];
const total = inputs => (level, seed) => {
  const sim = createSimulation({ scenario: level, seed });
  for (const input of inputs) sim.applyIntervention(input);
  sim.step(level.duration);
  const m = sim.metrics.snapshot();
  return { delay: (m.personDelay + m.pedestrianWaitSeconds) / 60, people: m.personsPerHour, unsafe: m.unsafeCrossings };
};
const measures = new Set(PLANS.flatMap(plan => plan.measures));
const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
const out = { seeds: SEEDS, minutes: LEVELS[0].duration / 60, conditions: {} };
for (const level of LEVELS) {
  const base = SEEDS.map(seed => total([])(level, seed));
  const row = { plans: {}, measures: {} };
  for (const plan of PLANS) {
    const runs = SEEDS.map(seed => total(plan.inputs)(level, seed));
    const saved = runs.map((r, i) => base[i].delay - r.delay);
    row.plans[plan.id] = { delay: mean(runs.map(r => r.delay)), saved: mean(saved), savedMin: Math.min(...saved), savedMax: Math.max(...saved),
      percent: mean(saved.map((s, i) => s / base[i].delay * 100)), people: mean(runs.map(r => r.people)), unsafe: mean(runs.map(r => r.unsafe)) };
  }
  for (const { name, inputs } of measures) {
    const saved = SEEDS.map((seed, i) => base[i].delay - total(inputs)(level, seed).delay);
    row.measures[name] = { saved: mean(saved), min: Math.min(...saved), max: Math.max(...saved) };
  }
  out.conditions[level.id] = row;
  console.log(level.id, Object.entries(row.plans).map(([k, v]) => k + ' ' + v.saved.toFixed(0) + ' (' + v.percent.toFixed(1) + '%)').join(' | '));
  console.log('   ', Object.entries(row.measures).map(([k, v]) => k.split(' ')[0] + ' ' + v.saved.toFixed(0)).join(' | '));
}
writeFileSync('data/measure-effects.json', JSON.stringify(out, null, 1));
