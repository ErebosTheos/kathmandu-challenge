import { sample } from './geometry.js';
import { TOOLS } from './params.js';
import { ARM_IDS, SIGNAL_ARM_IDS } from './scenarios.js';
import { clamp, normalizeSignalPlan } from './signals.js';

export const INTERVENTION_TYPES = TOOLS;
const aliases = {
  moveBusStop: 'moveStop', 'move-stop': 'moveStop', 'no-stopping-zone': 'noStoppingZone', 'bus-bay': 'busBay',
  'signal-timing': 'signalTiming', 'police-officer': 'policeOfficer', 'pedestrian-signal': 'pedestrianSignal',
  'free-left': 'freeLeft', freeLeftLane: 'freeLeft', 'info-campaign': 'infoCampaign',
};
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function createInterventions(network, budget, events, onChange) {
  const placements = [];
  let nextId = 0;
  let capital = 0;
  let operating = 0;
  const rules = { arms: {}, signal: {}, costSpent: 0, budgetRemaining: budget };
  function updateCost() {
    rules.costSpent = capital + operating;
    rules.budgetRemaining = budget - rules.costSpent;
  }
  function rebuild() {
    rules.signal = {};
    rules.adaptive = false;
    rules.laneDiscipline = false; rules.guardrails = false; rules.gradeSeparation = false; rules.underpass = false;
    rules.skybridge = false;
    rules.arms = Object.fromEntries(ARM_IDS.map(arm => [arm, {
      stops: network.arms[arm].stops.slice(), stopDistance: network.arms[arm].officialStop.distance, zones: [], bays: [], officers: [],
      crosswalk: 'gap', freeLeft: true, channelizedLeft: false, campaign: 0,
    }]));
    for (const item of placements) {
      if (!item.active) continue;
      const arm = rules.arms[item.arm];
      switch (item.type) {
        case 'moveStop':
          for (const local of Object.values(rules.arms)) {
            local.stops = local.stops.filter(stop => stop.relocated
              ? stop.sourceArm !== item.arm || stop.osmId !== item.stopId
              : local !== arm || stop.osmId !== item.stopId);
          }
          arm.stopDistance = item.distance;
          rules.arms[item.site.arm].stops.push(item.site);
          break;
        case 'noStoppingZone': arm.zones.push(item); break;
        case 'busBay': arm.bays.push(item); break;
        case 'signalTiming': rules.signal = item.plan; break;
        case 'policeOfficer': arm.officers.push(item); break;
        case 'zebra': arm.crosswalk = 'zebra'; break;
        case 'pedestrianSignal': arm.crosswalk = 'signal'; break;
        case 'freeLeft':
          arm.freeLeft = item.enabled;
          arm.channelizedLeft = item.enabled;
          break;
        case 'adaptiveSignals': rules.adaptive = true; break;
        case 'laneDiscipline': rules.laneDiscipline = true; break;
        case 'guardrails': rules.guardrails = true; break;
        case 'gradeSeparation': rules.gradeSeparation = true; break;
        case 'pedestrianUnderpass': rules.underpass = true; break;
        case 'pedestrianSkybridge': rules.skybridge = true; break;
        case 'infoCampaign':
          for (const local of Object.values(rules.arms)) local.campaign = TOOLS.infoCampaign.compliance;
          break;
      }
    }
    if (rules.adaptive) rules.signal = { ...rules.signal, mode: 'adaptive' };
    if (placements.some(item => item.active && item.type === 'policeOfficer' && item.manual)) {
      rules.signal = { ...rules.signal, mode: 'manual' };
    }
    updateCost();
    onChange(rules);
  }
  rebuild();

  return {
    rules,
    placements,
    apply(input, time) {
      if (!input || typeof input !== 'object') return { ok: false, reason: 'Invalid intervention' };
      const type = aliases[input.type] ?? input.type;
      const config = TOOLS[type];
      if (!Object.hasOwn(TOOLS, type)) return { ok: false, reason: 'Unknown intervention type' };
      if (rules.costSpent + config.cost > budget) return { ok: false, reason: 'Budget exceeded' };
      const arm = input.arm ?? 'north';
      if (!ARM_IDS.includes(arm)) return { ok: false, reason: 'Unknown approach arm' };
      const local = rules.arms[arm];
      const limit = network.arms[arm].incoming[0].path.length;
      const site = clamp(finite(input.distance ?? input.distanceFromStopLine, local.stopDistance), 0, limit);
      // A plan placed before the run starts (time 0) is evaluated as already built.
      const built = !config.buildTime || time === 0;
      const item = { id: ++nextId, type, arm, cost: config.cost, appliedAt: time, readyAt: built ? time : time + config.buildTime, active: built };
      if (type === 'moveStop') {
        const road = network.arms[arm];
        const stopId = input.stopId ?? road.officialStop.osmId;
        const original = road.stops.find(stop => stop.osmId === stopId);
        if (!original) return { ok: false, reason: 'Unknown bus stop on this approach' };
        const distance = finite(input.distance ?? input.distanceFromStopLine, original.distance);
        const side = input.side ?? (input.exitArm || distance < 0 ? 'far' : original.side);
        const targetArm = side === 'far' ? input.exitArm ?? arm : arm;
        if (!['near', 'far'].includes(side) || !network.arms[targetArm]) {
          return { ok: false, reason: 'Unknown stop location' };
        }
        const laneIndex = side === 'far' ? input.laneIndex ?? 0 : 0;
        const lane = network.arms[targetArm][side === 'far' ? 'outgoing' : 'incoming'][laneIndex];
        if (!lane || !Number.isInteger(laneIndex)) return { ok: false, reason: 'Unknown stop lane' };
        item.distance = clamp(Math.abs(distance), config.minDistance, Math.min(config.maxDistance, lane.path.length));
        const point = sample(lane.path, side === 'far' ? item.distance : lane.path.length - item.distance);
        item.stopId = stopId;
        item.site = { osmId: stopId, sourceArm: arm, arm: targetArm, side, laneIndex, distance: item.distance,
          point: [point.x, point.z], assumed: true, relocated: true, originalPoint: original.point };
      }
      if (type === 'noStoppingZone') {
        const length = clamp(finite(input.length, (input.end ?? 40) - (input.start ?? 0)), config.minLength, config.maxLength);
        item.start = clamp(finite(input.start, input.distance ?? 0), 0, Math.max(0, limit - length));
        item.end = item.start + length;
      }
      if (type === 'busBay') item.distance = input.distance == null && input.distanceFromStopLine == null ? null : site;
      if (type === 'policeOfficer') {
        item.distance = site;
        item.manual = input.manual === true;
      }
      if (type === 'signalTiming') {
        const options = input.plan ?? input;
        const splits = Object.fromEntries(SIGNAL_ARM_IDS.filter(id => Number.isFinite(options.splits?.[id])).map(id => [id, options.splits[id]]));
        item.plan = normalizeSignalPlan({ cycle: finite(options.cycle ?? options.cycleLength, undefined), splits, mode: options.mode });
      }
      if (type === 'freeLeft') item.enabled = input.enabled ?? !local.channelizedLeft;
      capital += item.cost;
      placements.push(item);
      rebuild();
      events.emit('intervention-applied', time, { interventionId: item.id, interventionType: type, arm, cost: item.cost, readyAt: item.readyAt });
      return { ok: true, ...item };
    },
    remove(id, time) {
      const index = placements.findIndex(item => item.id === (id?.id ?? id));
      if (index < 0) return false;
      const [item] = placements.splice(index, 1);
      capital -= item.cost;
      rebuild();
      events.emit('intervention-removed', time, { interventionId: item.id, interventionType: item.type, arm: item.arm, refund: item.cost });
      return true;
    },
    update(dt, time) {
      let changed = false;
      for (const item of placements) {
        if (!item.active && item.readyAt <= time) {
          item.active = true;
          changed = true;
          events.emit('intervention-ready', time, { interventionId: item.id, interventionType: item.type, arm: item.arm });
        }
        if (item.active && item.type === 'policeOfficer') {
          operating += Math.min(Math.max(0, budget - capital - operating), TOOLS.policeOfficer.perMinute * dt / 60);
        }
      }
      if (changed) rebuild();
      else updateCost();
    },
  };
}
