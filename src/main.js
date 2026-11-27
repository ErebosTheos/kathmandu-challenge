import './ui/style.css';
import { createAudio } from './audio.js';
import { createRun, LEVELS } from './game/levels.js';
import { ARM, TOOLS_UI, effect, locate, locationLabel, npr, toolName } from './game/tools.js';
import { anchorsFor, capturePoses, World } from './render/world.js';
import { createSimulation } from './sim/simulation.js';
import { SIGNAL, TOOLS } from './sim/params.js';
import { ARM_IDS, SIGNAL_ARM_IDS } from './sim/scenarios.js';
import { HUD } from './ui/hud.js';
import { icon } from './ui/icons.js';
import { auditScreen, creditsScreen, guideScreen, howScreen, levelsScreen, reportScreen, selectAuditStop, titleScreen, updateGuideBenchmark } from './ui/screens.js';

const app = document.querySelector('#app');
const canvas = document.querySelector('#scene');
const audio = createAudio();
let titleRunner = createSimulation({ scenario: 'morning', seed: LEVELS[0].seed });
const coarse = matchMedia('(pointer: coarse)');
let world;
let loadError = '';
let screen = 'title';
let run;
let hud;
let gameView;
let guideOrigin;
let tool = null;
let options;
let hovered = null;
let pointerDown = null;
let titleAccumulator = 0;
let lastFrame = performance.now();
let nextAudio = 0;
const page = { audit: auditScreen, how: howScreen, credits: creditsScreen, levels: levelsScreen };

function renderSound() {
  const button = app.querySelector('[data-action="mute"]');
  if (!button) return;
  const label = audio.muted ? 'Sound off' : 'Sound on';
  button.innerHTML = icon(audio.muted ? 'mute' : 'volume') + '<span>' + label + '</span>';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(!audio.muted));
}

function show(next) {
  screen = next;
  document.body.dataset.screen = next;
  document.getElementById('world').style.visibility = ['title', 'game'].includes(next) ? '' : 'hidden';
  world?.setMode(next);
  if (next === 'title') {
    if (world?.ready) world.attach(titleRunner.state);
    app.innerHTML = titleScreen(world?.ready);
    if (loadError) app.querySelector('#load-status').textContent = loadError;
  } else if (next === 'report') {
    world.setPlacementMode(false);
    world.setAnchors([]);
    app.innerHTML = reportScreen(run, run.makeReport());
  } else if (next === 'guide') {
    const inRun = guideOrigin === 'game' || guideOrigin === 'report';
    app.innerHTML = guideScreen(inRun ? run.level.id : LEVELS[0].id, guideOrigin);
  } else if (next !== 'game') {
    app.innerHTML = page[next]();
  }
  renderSound();
  window.scrollTo(0, 0);
}

function returnToGame() {
  app.replaceChildren(gameView);
  show('game');
  hud.update(world, performance.now(), true);
}

function newShift(level, plan = [], keepCamera = false) {
  if (!level || !world?.ready) return;
  run = createRun(level);
  options = { sourceArm: 'north', stopId: run.sim.state.network.arms.north.officialStop.osmId, side: 'near', length: 30,
    manual: false, pedSignal: false, plan: { cycle: SIGNAL.cycle, splits: { ...SIGNAL.splits } } };
  tool = null;
  hovered = null;
  pointerDown = null;
  world.attach(run.sim.state);
  world.setPlacementMode(false);
  world.setQueue(true);
  if (!keepCamera) world.setPreset('overview', true);
  run.sims.forEach((sim, index) => sim.events.subscribe(event => { if (index === run.view) world.addPopup(event); }));
  hud = new HUD(app, run);
  gameView = app.firstElementChild;
  show('game');
  hud.update(world, performance.now(), true);
}

function isGlobalTool() { return tool === 'signalTiming' || tool === 'infoCampaign'; }

function refreshAnchors() {
  if (!tool) world.setAnchors([]);
  else if (isGlobalTool()) world.setAnchors([{ x: world.centre.x, z: world.centre.z, arm: 'junction', name: 'Apply at junction' }]);
  else world.setAnchors(anchorsFor(run.sim.state, tool, options));
}

function mobilePanel(which, open) {
  const panels = app.querySelector('.game-screen');
  const next = open ? which : '';
  panels.dataset.mobile = next;
  for (const name of ['tools', 'insights']) {
    app.querySelector('[data-action="mobile-' + name + '"]').setAttribute('aria-expanded', String(name === next));
  }
}

function selectTool(next) {
  tool = next;
  hovered = null;
  pointerDown = null;
  world.setPlacementMode(Boolean(tool));
  world.setPreview(null);
  hud.configure(tool, options);
  refreshAnchors();
  if (tool) {
    hud.el.tutorial.hidden = true;
    if (coarse.matches) mobilePanel('tools', false);
  }
}

function previewAt(event) {
  if (!tool) return null;
  const point = world.ground(event.clientX, event.clientY);
  let site = null;
  if (point && isGlobalTool() && Math.hypot(point.x - world.centre.x, point.z - world.centre.z) < 45) {
    site = locate(run.sim.state, tool, options, point);
  } else if (point && !isGlobalTool()) {
    site = locate(run.sim.state, tool, options, point);
  }
  const key = site?.arm ? site.arm + ':' + site.distance + ':' + JSON.stringify(site.input) : '';
  if (key !== (hovered?.key ?? '')) world.setPreview(site, site?.arm ? locationLabel(site) : '');
  hovered = site ? { key, site } : null;
  hud.preview(tool, options, site);
  return site;
}

// Changes are always evaluated from the start of the run, so the comparison with
// today's junction stays fair. Editing after Run restarts both runs from 0:00.
function restartWith(plan, message) {
  const level = run.level;
  newShift(level, plan, true);
  run.advise(message);
  hud.notice(message, performance.now());
}

function apply(site) {
  const name = toolName(site.input.type);
  const label = name + (site.arm ? ' · ' + locationLabel(site) : '');
  if (run.started) {
    selectTool(null);
    restartWith([...run.plan.map(entry => entry.input), site.input], name + ' added. Plan restarted from 0:00 so it is compared fairly with today.');
    return;
  }
  const result = run.sim.applyIntervention(site.input);
  if (!result.ok) {
    hud.notice(result.reason, performance.now());
    return;
  }
  run.plan.push({ input: site.input, id: result.id });
  run.record(label, result);
  run.advise(name + (site.arm ? ' at ' + ARM[site.arm] : '') + ' added to the plan. ' + effect(result.type, site, options));
  hud.notice(label + ' added · ' + run.plan.length + ' change' + (run.plan.length === 1 ? '' : 's') + ' in plan', performance.now());
  audio.click();
  selectTool(null);
  hud.update(world, performance.now(), true);
}

function undo(id) {
  const entry = run.plan.find(item => item.id === Number(id));
  if (!entry) return;
  const remaining = run.plan.filter(item => item !== entry).map(item => item.input);
  if (run.started) {
    restartWith(remaining, toolName(entry.input.type) + ' removed. Plan restarted from 0:00.');
    return;
  }
  if (run.sim.removeIntervention(entry.id)) {
    run.plan.splice(run.plan.indexOf(entry), 1);
    run.record('Removed · ' + toolName(entry.input.type), entry, true);
    run.advise(toolName(entry.input.type) + ' removed from the plan.');
    hud.update(world, performance.now(), true);
  }
}

function startRun() {
  if (!run.speed) setSpeed(4);
  hud.el.tutorial.hidden = true;
  if (!run.started) run.advise('Running Now, Short-term and Long-term on identical traffic.');
}

function setSpeed(speed) {
  run.setSpeed(speed);
  hud.buttons('[data-speed]', 'speed', speed);
  hud.update(world, performance.now(), true);
}

function setCamera(name) {
  if (world.setPreset(name)) hud.buttons('[data-camera]', 'camera', name);
  else hud.notice('Select a vehicle in the scene to follow it.', performance.now());
}

function setView(index) {
  run.setView(index);
  world.attach(run.sim.state);
  hud.buttons('[data-view]', 'view', index);
  hud.stage();
  hud.update(world, performance.now(), true);
}

function doAction(button) {
  const action = button.dataset.action;
  if (action === 'mute') { audio.toggle(); renderSound(); }
  if (screen !== 'game') return;
  if (action === 'dismiss-tutorial') hud.el.tutorial.hidden = true;
  if (action === 'run-sim') startRun();
  if (action === 'tunnel-xray') {
    world.tunnel.toggle();
    hud.update(world, performance.now(), true);
  }
  if (action === 'show-results' && run.started) {
    setSpeed(0);
    show('report');
    return;
  }
  if (action === 'cancel-tool') selectTool(null);
  if (action === 'apply-global' && isGlobalTool()) apply(locate(run.sim.state, tool, options, world.centre));
  if (action === 'mobile-tools' || action === 'mobile-insights') {
    const which = action.slice(7);
    mobilePanel(which, button.getAttribute('aria-expanded') !== 'true');
  }
  if (['charts', 'ghost', 'queue'].includes(action)) {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    if (action === 'queue') world.setQueue(enabled);
    else hud.el[action].hidden = !enabled;
    hud.update(world, performance.now(), true);
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, [role="button"]');
  if (!button || button.disabled) return;
  audio.start();
  audio.click();
  const { screen: next, level, auditStop } = button.dataset;
  if (next) { show(next); return; }
  const { action, guideJump } = button.dataset;
  if (action === 'open-guide') {
    guideOrigin = screen;
    show('guide');
    app.querySelector('h1').focus({ preventScroll: true });
    return;
  }
  if (action === 'close-guide' && screen === 'guide') {
    if (guideOrigin === 'game') returnToGame();
    else show(guideOrigin);
    app.querySelector('[data-action="open-guide"]').focus();
    return;
  }
  if (guideJump && screen === 'guide') {
    const heading = document.getElementById('guide-heading-' + guideJump);
    heading.focus({ preventScroll: true });
    heading.scrollIntoView();
    return;
  }
  if (action === 'return-to-run' && screen === 'report') {
    returnToGame();
    return;
  }
  if (button.dataset.action === 'rerun-plan' && run) { newShift(run.level); startRun(); return; }
  if (level) { newShift(LEVELS.find(entry => entry.id === level), button.dataset.keepPlan && run ? run.plan.map(entry => entry.input) : []); return; }
  if (auditStop) selectAuditStop(auditStop);
  if (screen === 'game') {
    const { speed, camera, tool: nextTool, side, remove, view } = button.dataset;
    if (view !== undefined) setView(Number(view));
    if (speed !== undefined) setSpeed(Number(speed));
    if (camera) setCamera(camera);
    if (nextTool) selectTool(tool === nextTool ? null : nextTool);
    if (side) { options.side = side; hud.configure(tool, options); refreshAnchors(); }
    if (remove) undo(remove);
  }
  doAction(button);
});
document.addEventListener('pointerdown', () => audio.start(), { once: true });
app.addEventListener('change', event => {
  if (screen === 'guide' && event.target.id === 'guide-condition') updateGuideBenchmark(event.target.value);
});
app.addEventListener('input', event => {
  if (screen !== 'game' || !tool) return;
  const { name, value, checked } = event.target;
  if (name === 'length') options.length = Number(value);
  if (name === 'source') {
    const [arm, stopId] = value.split(':');
    options.sourceArm = arm;
    options.stopId = stopId ? Number(stopId) : null;
    refreshAnchors();
  }
  if (name === 'cycle') options.plan.cycle = Number(value);
  if (name.startsWith('split-')) {
    options.plan.splits = Object.fromEntries(SIGNAL_ARM_IDS.map(arm =>
      [arm, Number(hud.el['tool-details'].querySelector('[name="split-' + arm + '"]').value) / 100]));
  }
  if (name === 'crossing') { options.pedSignal = value === 'signal'; refreshAnchors(); }
  if (name === 'manual') options.manual = checked;
  hud.preview(tool, options, null);
});
canvas.addEventListener('pointerdown', event => {
  if (screen !== 'game') return;
  if (!event.isPrimary || event.button !== 0) {
    pointerDown = null;
    return;
  }
  if (!tool) world.cancelCameraTravel();
  pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId, tool };
  if (tool) {
    canvas.setPointerCapture(event.pointerId);
    previewAt(event);
  }
});
canvas.addEventListener('pointermove', event => {
  if (screen === 'game' && tool && event.isPrimary) previewAt(event);
});
canvas.addEventListener('pointerleave', () => {
  if (screen === 'game' && tool && !pointerDown) {
    hovered = null;
    world.setPreview(null);
    hud.preview(tool, options, null);
  }
});
canvas.addEventListener('pointercancel', () => { pointerDown = null; });
canvas.addEventListener('pointerup', event => {
  if (screen !== 'game' || !pointerDown || event.pointerId !== pointerDown.id) return;
  const travelled = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (tool) {
    if (travelled > 10 && tool !== 'moveStop') return;
    const site = previewAt(event);
    if (site) apply(site);
    else hud.notice('Aim at a marked curb or approach before placing.', performance.now());
  } else if (travelled < 7) {
    const found = world.pick(event.clientX, event.clientY);
    if (found && coarse.matches) mobilePanel('insights', true);
    hud.update(world, performance.now(), true);
  }
});
document.addEventListener('keydown', event => {
  if (event.target.matches('[role="button"]') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    const next = event.target.dataset.screen;
    if (next) show(next);
    return;
  }
  if (screen !== 'game' || event.repeat || event.target.matches('input, select, button')) return;
  if (event.key === 'Escape' && tool) selectTool(null);
  if (event.key === ' ') { event.preventDefault(); if (run.speed) setSpeed(0); else startRun(); }
  if (['1', '2', '3'].includes(event.key)) setView(Number(event.key) - 1);
});
window.addEventListener('blur', () => { pointerDown = null; });

function beforeStep(active, baseline) {
  capturePoses(active);
  capturePoses(baseline);
}

function frame(now) {
  requestAnimationFrame(frame);
  const seconds = Math.min(0.35, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!world?.ready) return;
  if (screen === 'title') {
    titleAccumulator += seconds * 1.5;
    while (titleAccumulator >= 0.25) {
      titleAccumulator -= 0.25;
      capturePoses(titleRunner.state);
      titleRunner.step();
      if (titleRunner.state.time >= 140) return resetTitle();
    }
    world.draw(titleRunner.state, titleAccumulator / 0.25, seconds);
  }
  if (screen === 'game') {
    run.advance(seconds, beforeStep);
    hud.el.ghost.classList.toggle('off', run.view === 0);
    const ghost = hud.el.ghost.hidden || run.view === 0 ? null : run.baseline.state;
    world.draw(run.sim.state, run.fraction, seconds, run.latestConflict, ghost, hud.el['ghost-viewport']);
    hud.update(world, now);
  }
  if (now >= nextAudio) {
    nextAudio = now + 450;
    const live = screen === 'game' ? run.sim : titleRunner;
    audio.traffic(live.state.vehicles.length, ARM_IDS.reduce((total, arm) => total + live.metrics.queueByArm[arm], 0), screen === 'title' || screen === 'game' && run.speed > 0);
  }
}

// Restart the title traffic quietly so leaving the home screen open cannot grow demand indefinitely.
function resetTitle() {
  titleAccumulator = 0;
  titleRunner = createSimulation({ scenario: 'morning', seed: LEVELS[0].seed });
  titleRunner.step(40);
  world.attach(titleRunner.state);
}

async function boot() {
  show('title');
  try {
    world = new World(canvas, document.querySelector('#world-labels'));
    await world.load();
    titleRunner.step(40);
    if (screen === 'title') show('title');
  } catch (error) {
    loadError = 'The 3D junction could not load. Reload in a browser with WebGL 2 enabled.';
    if (screen === 'title') show('title');
    if (import.meta.env.DEV) console.error(error);
  }
  requestAnimationFrame(frame);
}
boot();
