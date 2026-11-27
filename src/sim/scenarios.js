import { CLOCK, DEMAND } from './params.js';

// The OSM geometry puts NH34 between the north and NH39 southwest approaches.
export const ARM_IDS = Object.freeze(['north', 'east', 'south', 'west']);
export const SIGNAL_ARM_IDS = Object.freeze(['north', 'south', 'east']);
export const TURN_IDS = Object.freeze(['left', 'through', 'right']);
const DEMAND_ORDER = ['north', 'south', 'east', 'west'];
const titles = {
  morning: 'Morning rush',
  busBunching: 'Bus bunching',
  rain: 'Evening peak + rain',
  dashain: 'Dashain exodus',
  sandbox: 'Sandbox',
};

const destinations = {
  north: { through: 'east', right: 'south' },
  south: { left: 'west', through: 'north', right: 'east' },
  east: { left: 'south', through: 'north' },
  west: { left: 'north' },
};

export function destinationFor(arm, turn) {
  return destinations[arm]?.[turn];
}

export const SCENARIOS = Object.freeze(Object.fromEntries(Object.entries(DEMAND).filter(([id]) => id in titles).map(([id, settings]) => {
  const demand = Object.fromEntries(ARM_IDS.map(arm => {
    const index = DEMAND_ORDER.indexOf(arm);
    const fractions = [...DEMAND.defaultTurns[arm]];
    const eastbound = settings.eastbound?.[index];
    if (eastbound) {
      const eastTurn = TURN_IDS.findIndex(turn => destinationFor(arm, turn) === 'east');
      const scale = (1 - eastbound) / (1 - fractions[eastTurn]);
      for (let i = 0; i < fractions.length; i++) fractions[i] = i === eastTurn ? eastbound : fractions[i] * scale;
    }
    return [arm, Object.freeze({
      vehiclesPerHour: settings.rates[index],
      movements: Object.freeze(Object.fromEntries(TURN_IDS.map((turn, i) => [turn, settings.rates[index] * fractions[i]]))),
      pedestriansPerHour: settings.pedestrians[index],
      stopShare: settings.stopShare[index],
      transitMultiplier: settings.transitMultiplier?.[index] ?? 1,
    })];
  }));
  return [id, Object.freeze({
    id, name: titles[id], demand: Object.freeze(demand), speed: settings.speed,
    dwell: settings.dwell, informal: settings.informal, budget: settings.budget, duration: CLOCK.levelDuration,
    objective: id === 'morning' ? { personDelayReduction: 0.2, maxAddedUnsafeCrossings: 0 } : null,
  })];
})));

export function getScenario(scenario = 'morning') {
  if (typeof scenario === 'object' && scenario?.demand) return scenario;
  if (SCENARIOS[scenario]) return SCENARIOS[scenario];
  throw new RangeError(`Unknown traffic scenario: ${scenario}`);
}
