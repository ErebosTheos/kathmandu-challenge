import { SIGNAL, TOOLS } from './params.js';
import { SIGNAL_ARM_IDS } from './scenarios.js';

const ORDER = SIGNAL_ARM_IDS;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeSignalPlan(options = {}) {
  const cycle = clamp(options.cycle ?? options.cycleLength ?? SIGNAL.cycle, ...SIGNAL.cycleLimits);
  const weights = ORDER.map(arm => Math.max(0, options.splits?.[arm] ?? SIGNAL.splits[arm]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const availableGreen = cycle - ORDER.length * (SIGNAL.amber + SIGNAL.allRed + SIGNAL.minGreen);
  const splits = {};
  const greens = {};
  for (const [i, arm] of ORDER.entries()) {
    splits[arm] = total ? weights[i] / total : 1 / ORDER.length;
    greens[arm] = SIGNAL.minGreen + splits[arm] * availableGreen;
  }
  return { cycle, splits, greens, mode: ['manual', 'adaptive'].includes(options.mode) ? options.mode : 'fixed' };
}

export function createSignals(random) {
  let phaseIndex = 0;
  let plan = normalizeSignalPlan();
  const state = { arm: ORDER[0], stage: 'green', elapsed: 0, remaining: plan.greens[ORDER[0]], plan, nextRequested: null };
  function duration(queue) {
    const green = plan.greens[state.arm];
    if (plan.mode === 'fixed') return green;
    if (plan.mode === 'adaptive') {
      const a = TOOLS.adaptiveSignals;
      return Math.min(green * a.maxFactor, Math.max(a.minGreen, green * (a.base + (queue[state.arm] ?? 0) * a.perVehicle)));
    }
    const gain = Math.min(SIGNAL.manualMaxQueueGain, (queue[state.arm] ?? 0) * SIGNAL.manualQueueGain);
    return green * SIGNAL.manualFactor * (1 + gain + (random() - 0.5) * SIGNAL.manualVariation);
  }
  return {
    state,
    configure(options, queue) {
      const next = normalizeSignalPlan(options);
      if (JSON.stringify(next) === JSON.stringify(plan)) return;
      state.plan = plan = next;
      if (state.stage === 'green') state.remaining = Math.max(0, duration(queue) - state.elapsed);
      if (plan.mode === 'fixed') state.nextRequested = null;
    },
    requestPhase(arm) {
      if (!ORDER.includes(arm) || plan.mode !== 'manual') return false;
      state.nextRequested = arm;
      return true;
    },
    update(dt, queue) {
      state.remaining -= dt;
      state.elapsed += dt;
      if (state.stage === 'green' && state.nextRequested && state.elapsed >= SIGNAL.minGreen) state.remaining = Math.min(0, state.remaining);
      while (state.remaining <= 0) {
        const excess = -state.remaining;
        if (state.stage === 'green') {
          state.stage = 'amber';
          state.remaining = SIGNAL.amber;
        } else if (state.stage === 'amber') {
          state.stage = 'allRed';
          state.remaining = SIGNAL.allRed;
        } else {
          phaseIndex = state.nextRequested ? ORDER.indexOf(state.nextRequested) : (phaseIndex + 1) % ORDER.length;
          state.nextRequested = null;
          state.arm = ORDER[phaseIndex];
          state.stage = 'green';
          state.remaining = duration(queue);
        }
        state.elapsed = excess;
        state.remaining -= excess;
      }
    },
    green(arm) {
      return state.stage === 'green' && state.arm === arm;
    },
  };
}
