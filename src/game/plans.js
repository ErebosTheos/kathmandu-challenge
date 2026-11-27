import { SIGNAL_ARM_IDS } from '../sim/scenarios.js';
import { TOOLS } from '../sim/params.js';

const bayDistance = 60;
const onMainArms = type => SIGNAL_ARM_IDS.map(arm => ({ type, arm }));
const adaptiveSignals = {
  name: 'Adaptive signal timings', icon: 'signal', inputs: [{ type: 'adaptiveSignals' }],
  model: 'At the start of each phase, the controller adjusts green time to the queue on that approach. Light queues get shorter greens, and long queues can extend a green up to ' + TOOLS.adaptiveSignals.maxFactor + ' times its fixed duration.',
  watch: 'Compare queue lengths by approach. A longer green can clear one queue while making people on another approach wait longer.',
  next: 'Measure turning volumes and queue lengths by time of day, then check that the controller can provide adequate pedestrian clearance.',
};
const laneDiscipline = {
  name: 'Lane discipline, merges upstream', icon: 'turn', inputs: [{ type: 'laneDiscipline' }],
  model: 'Through drivers stay in their incoming lane for the final ' + TOOLS.laneDiscipline.mergeZone + ' m before the stop line unless they still need to make a transit stop. The idea is to move discretionary weaving upstream.',
  watch: 'Fewer late lane changes can smooth the approach. If a bus or queue blocks a lane, through drivers have fewer ways around it.',
  next: 'Observe where drivers merge today and check where lane markings, advance signs and enforcement would be workable.',
};
const busBays = {
  name: 'Stops moved 60 m back into off-lane bays', icon: 'bus',
  inputs: SIGNAL_ARM_IDS.flatMap(arm => [
    { type: 'moveStop', arm, side: 'near', distance: bayDistance },
    { type: 'busBay', arm, distance: bayDistance },
  ]),
  model: 'On each main approach, the plan relocates one modeled stop to ' + bayDistance + ' m before the stop line and gives eligible buses, microbuses and tempos a bay outside the through lane.',
  watch: 'Watch how long boarding blocks a lane. Full bays and informal stops can still block traffic, and a relocated stop can add walking for passengers.',
  next: 'Check curb space, boarding demand, walking routes and whether buses can safely merge back into traffic.',
};
const guardrails = {
  name: 'Guardrails', icon: 'ban', inputs: [{ type: 'guardrails' }],
  model: 'The model treats guardrails as full compliance with the crossing rule. A person waits for a usable gap or a walk phase instead of stepping into traffic after a long wait.',
  watch: 'Simulated unsafe crossings can fall while waiting rises. Check both measures to see the trade-off.',
  next: 'Observe where people actually want to cross, then check that barriers lead to direct, usable crossings.',
};
const pedestrianSignals = {
  name: 'Marked crossings with walk phase', icon: 'crossing', inputs: onMainArms('pedestrianSignal'),
  model: 'The three signalized approaches get marked crossings. Pedestrians can start while a different approach has a green, provided there is enough time left to cross.',
  watch: 'A designated crossing window can reduce conflicts. Turning traffic can wait for people already crossing, and people may wait longer for a usable window.',
  next: 'Measure walking speeds and turning conflicts to verify clearance times, curb ramps and the signal sequence.',
};
const tunnel = {
  name: 'Tinkune–Jadibuti tunnel', icon: 'layers', inputs: [{ type: 'gradeSeparation' }],
  model: 'Through trips between Tinkune on Ring Road north and Jadibuti on Araniko Highway pass below the junction in both directions. Other movements stay on the surface. Tunnel vehicles travel at an assumed speed and count toward throughput when they exit.',
  watch: 'Use Tunnel cutaway to follow through trips. Surface queues can shrink, while the effect of real portal queues and merging is outside this model.',
  next: 'Study portal capacity, land and utilities, ground conditions, drainage, construction staging, and emergency access.',
};
const skybridges = {
  name: 'Pedestrian skybridges', icon: 'crossing', inputs: [{ type: 'pedestrianSkybridge' }],
  model: 'Stair-access bridges carry pedestrians over Ring Road north, Ring Road southwest and Araniko Highway. Seti O.P. Marg keeps a surface crossing.',
  watch: 'The bridges remove the wait for a traffic gap on those three approaches. Pedestrians still spend time climbing and walking, which the delay metric does not count as crossing wait.',
  next: 'Compare accessible routes, step-free access and total walking time before choosing a bridge layout.',
};

export const PLANS = [
  { id: 'now', name: 'Now', short: 'Modeled baseline', colour: '#8ea0b4', measures: [],
    summary: 'Fixed signal timings serve three main approaches. Transit vehicles can board in a running lane and pedestrians cross in gaps. Seti O.P. Marg is modeled as a give-way connection with zero demand in the preset conditions.' },
  { id: 'short', name: 'Short-term', short: 'Surface changes', colour: '#f5a970',
    summary: 'Reorganize traffic, boarding and walking on the existing streets. This package tests five changes that could inform a surface pilot.',
    measures: [adaptiveSignals, laneDiscipline, busBays, guardrails, pedestrianSignals] },
  { id: 'long', name: 'Long-term', short: 'Tunnel and skybridges', colour: '#8ed7b0',
    summary: 'Separate through traffic and pedestrians from the surface junction. This package carries forward adaptive signals and relocated bays. Through-lane restrictions, guardrails and walk phases belong to the short-term package.',
    measures: [tunnel, skybridges, adaptiveSignals, busBays] },
].map(plan => ({ ...plan, inputs: plan.measures.flatMap(measure => measure.inputs) }));
