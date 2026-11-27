import { ARM_IDS, SIGNAL_ARM_IDS } from '../sim/scenarios.js';
import { CLOCK, SIGNAL, TOOLS } from '../sim/params.js';
import { normalizeSignalPlan } from '../sim/signals.js';
import { savings } from '../game/levels.js';
import { PLANS } from '../game/plans.js';
import effects from '../../data/measure-effects.json';
import { ARM, TOOLS_UI, VEHICLE, clock, effect, locationLabel, npr, signed, toolName } from '../game/tools.js';
import { benchmarkWindow, brand, delayEffect, escapeHTML, number, osm } from './screens.js';
import { icon } from './icons.js';

const btn = (action, label, symbol, extra = '') => '<button type="button" data-action="' + action + '" ' + extra + '>' + (symbol ? icon(symbol) : '') + label + '</button>';
const abbreviations = { north: 'Ring Rd N', south: 'Ring Rd SW', east: 'Araniko', west: 'Seti' };
const units = [['persons', 'people/h', 0], ['delay', 'person-s/min', 0], ['blocked', 'lane-s/min', 1], ['unsafe', 'conflicts/min', 2]];
const defaultSummary = 'Select a tool to preview its effect in the scene.';

export function gameHud(level) {
  return `<main class="game-screen" aria-label="${level.name}">
    <header class="hud-top glass">
      <button class="wordmark" data-screen="levels" aria-label="Scenario select">${brand}</button>
      <div class="shift-title"><strong>${level.name}</strong><span id="phase-readout"></span></div>
      <div class="clock-wrap"><span class="hud-caption">SIM TIME</span><strong id="sim-clock">0:00</strong></div>
      <div class="seg speed" aria-label="Playback speed">${CLOCK.speeds.map(speed => '<button data-speed="' + speed + '" aria-pressed="' + (speed === 0) + '" aria-label="' + (speed ? speed + '× speed' : 'Pause') + '">' + (speed ? speed + '×' : icon('pause')) + '</button>').join('')}</div>
      <button type="button" class="primary run-button" data-action="run-sim" id="run-button">${icon('play')}<span>Run</span></button>
      ${btn('show-results', 'Results', '', 'id="results-button" disabled')}
      <div class="budget-wrap saved-wrap"><span class="hud-caption">SHORT-TERM VS NOW</span><strong id="time-saved">–</strong><small id="time-saved-sub"></small></div>
      <div class="budget-wrap saved-wrap"><span class="hud-caption">LONG-TERM VS NOW</span><strong id="time-saved-long">–</strong><small id="time-saved-long-sub"></small></div>
      ${btn('mute', '<span>Sound on</span>', 'volume', 'class="muter"')}
    </header>
    <div class="hud-tools glass" id="tools-panel">
      <p class="hud-caption steps-caption">COMPARE ON IDENTICAL TRAFFIC</p>
      <div class="steps">${PLANS.map((plan, i) => '<button class="step" data-view="' + i + '" aria-pressed="' + (i === 0) + '" style="--plan:' + plan.colour + '"><span class="step-num">' + (i + 1) + '</span><span class="step-text"><strong>' + plan.name + '</strong><small>' + plan.short + '</small></span><span class="step-saved" id="saved-' + plan.id + '">' + (i ? '' : 'baseline') + '</span></button>').join('')}</div>
      <div class="stage-info" id="stage-info"></div>
    </div>
    <div class="hud-insights glass" id="insights-panel">
      <div class="panel-head inspector-head"><span class="inspector-icon">${icon('officer')}</span><div><h2>Traffic Inspector</h2><small>Live field notes</small></div></div>
      <div class="advice-feed" id="advice" aria-label="Traffic Inspector messages"></div>
      <div class="insights-scroll">
        <div class="panel-head"><h2>Junction metrics</h2><small id="baseline-indicator">LIVE</small></div>
        <div class="metric-grid" id="metrics"></div>
        <details class="metric-details"><summary>All metrics</summary><div id="more-metrics"></div></details>
        <div id="vehicle-inspector" hidden></div>

      </div>
    </div>
    <div class="tutorial glass" id="tutorial"><div><strong>Press Run, then switch between plans</strong><p>All three plans run on the same seeded demand. Open the Plan guide to see what changes in each one.</p></div>${btn('dismiss-tutorial', '', 'close', 'aria-label="Dismiss tutorial"')}</div>
    <div class="notice" id="notice" role="status" hidden></div>
    <div class="ghost glass" id="ghost"><div><i class="dot" style="background:#8ea0b4"></i> Now · today's junction · same traffic</div><div class="ghost-viewport" id="ghost-viewport" aria-label="Baseline 3D viewport"></div><div class="ghost-deltas" id="ghost-deltas"></div></div>
    <section class="charts glass" id="charts" aria-label="Time series charts" hidden><div class="panel-head"><h2>Traffic over time</h2><small>Simulated minutes</small></div><canvas id="chart-canvas" role="img" aria-label="Time series for person throughput, mean delay and queue length"></canvas></section>
    <footer class="hud-bottom">
      <div class="bottom-controls glass">
        ${btn('mobile-tools', 'Plans', 'layers', 'class="mobile-switch" aria-controls="tools-panel" aria-expanded="false"')}
        ${btn('mobile-insights', 'Inspector', 'officer', 'class="mobile-switch" aria-controls="insights-panel" aria-expanded="false"')}
        <span class="seg camera-menu" aria-label="Camera presets">${['Overview', 'Street', 'Bird', 'Follow'].map(name => '<button data-camera="' + name.toLowerCase() + '" aria-pressed="' + (name === 'Overview') + '">' + name + '</button>').join('')}</span>
        ${btn('queue', 'Heatmap', 'layers', 'aria-pressed="true"')}
        ${btn('ghost', 'Now (inset)', 'compare', 'aria-pressed="true"')}
        ${btn('charts', 'Charts', 'chart', 'aria-pressed="false"')}
      </div>
      <span class="map-credit">${osm}</span>
    </footer>
  </main>`;
}

export class HUD {
  constructor(root, run) {
    this.root = root;
    this.run = run;
    root.innerHTML = gameHud(run.level);
    queueMicrotask(() => this.stage());
    this.el = Object.fromEntries([...root.querySelectorAll('[id]')].map(element => [element.id, element]));
    this.canvas = this.el['chart-canvas'];
    this.lastAdvice = null;
    this.previewKey = '';
    this.selected = null;
  }

  stage() {
    const { run } = this;
    const plan = PLANS[run.view];
    const avg = effects.conditions[run.level.id];
    const box = this.el['stage-info'];
    const guide = btn('open-guide', 'Plan guide', 'layers', 'class="stage-guide"');
    if (!plan.inputs.length) {
      box.innerHTML = '<h3>Modeled baseline</h3><p>' + plan.summary + '</p>' + guide;
      return;
    }
    const p = avg.plans[plan.id];
    box.innerHTML = '<h3>' + plan.short + '</h3>' +
      (plan.id === 'long' ? '<div class="tunnel-controls">' +
        btn('tunnel-xray', 'Tunnel cutaway', 'layers', 'id="tunnel-xray" aria-pressed="true"') +
        '<p><span>Vehicle tunnel</span><span>Pedestrian skybridges</span></p></div>' : '') +
      '<p>' + plan.summary + '</p>' + guide +
      '<details><summary>Measures in this package</summary><ul class="measure-list">' + plan.measures.map(measure =>
        '<li><strong>' + measure.name + '</strong><span>' + measure.model + '</span></li>').join('') + '</ul></details>' +
      '<p class="log-note">Benchmark average vs Now<br><strong class="' + (p.saved > 0 ? 'good' : 'bad') + '">' +
      delayEffect(p.saved) + '</strong> · ' + benchmarkWindow + '.</p>';
  }

  buttons(selector, key, value) {
    for (const button of this.root.querySelectorAll(selector)) button.setAttribute('aria-pressed', String(button.dataset[key] === String(value)));
  }

  configure(tool, options) {
    this.buttons('[data-tool]', 'tool', tool);
    const panel = this.el['tool-details'];
    panel.hidden = !tool;
    this.previewKey = '';
    if (!tool) { panel.innerHTML = ''; return; }
    let config = '';
    if (tool === 'moveStop') {
      const choices = ARM_IDS.flatMap(arm => this.run.sim.state.network.arms[arm].stops.map(stop => {
        const kind = stop.assumed ? 'assumed' : stop.side === 'far' ? 'mapped far side' : 'mapped near side';
        const id = stop.osmId ?? '';
        return '<option value="' + arm + ':' + id + '" ' + (arm === options.sourceArm && stop.osmId === options.stopId ? 'selected' : '') + '>' + ARM[arm] + ' · ' + kind + '</option>';
      }));
      config = `<label class="select-label">Source stop<select name="source">${choices.join('')}</select></label><div class="seg side-control"><button data-side="near" aria-pressed="${options.side === 'near'}">Near side</button><button data-side="far" aria-pressed="${options.side === 'far'}">Far side</button></div>`;
    }
    if (tool === 'noStoppingZone') {
      config = '<label>Length <output id="zone-length">' + options.length + ' m</output><input name="length" type="range" min="' + TOOLS.noStoppingZone.minLength + '" max="' + TOOLS.noStoppingZone.maxLength + '" step="1" value="' + options.length + '"></label>';
    }
    if (tool === 'zebra') {
      config = '<label class="select-label">Crossing type<select name="crossing"><option value="zebra">Zebra crossing</option><option value="signal"' + (options.pedSignal ? ' selected' : '') + '>Pedestrian signal</option></select></label>';
    }
    if (tool === 'policeOfficer') {
      config = '<label class="check-label"><input name="manual" type="checkbox" ' + (options.manual ? 'checked' : '') + '> Enable manual junction control</label>';
    }
    if (tool === 'signalTiming') {
      config = '<label>Cycle <output id="cycle-length"></output><input name="cycle" type="range" min="' + SIGNAL.cycleLimits[0] + '" max="' + SIGNAL.cycleLimits[1] + '" value="' + options.plan.cycle + '"></label>' +
        SIGNAL_ARM_IDS.map(arm => '<label>' + abbreviations[arm] + ' <output data-green="' + arm + '"></output><input name="split-' + arm + '" type="range" min="1" max="100" value="' + Math.round(options.plan.splits[arm] * 100) + '"></label>').join('') +
        '<div class="phase-diagram" aria-label="Proposed signal phases"></div>';
    }
    panel.innerHTML = '<div class="panel-head"><h3>' + toolName(tool) + '</h3>' + btn('cancel-tool', '', 'close', 'aria-label="Cancel placement"') + '</div>' + config +
      '<p id="placement-effect"></p><p class="placement-distance" id="placement-distance"></p><small id="placement-price"></small>' +
      (tool === 'signalTiming' || tool === 'infoCampaign' ? btn('apply-global', 'Apply at junction', 'check', 'class="primary global-apply"') : '');
    this.preview(tool, options, null);
  }

  preview(tool, options, site) {
    if (!tool) return;
    const type = tool === 'zebra' && options.pedSignal ? 'pedestrianSignal' : tool;
    const config = TOOLS[type];
    const isGlobal = tool === 'signalTiming' || tool === 'infoCampaign';
    const location = site?.arm ? locationLabel(site) : isGlobal ? 'Applies junction-wide' : tool === 'moveStop' ? 'Aim at a curb or drag the stop to a new site' : 'Aim at a curb or approach';
    const prediction = effect(type, site, options);
    const price = 'Estimated cost ' + npr(config.cost) + ' (illustrative) · active from 0:00';
    const key = location + '|' + prediction + '|' + price;
    if (this.previewKey !== key) {
      this.previewKey = key;
      this.el['tool-details'].querySelector('#placement-effect').textContent = prediction;
      this.el['tool-details'].querySelector('#placement-distance').textContent = location;
      this.el['tool-details'].querySelector('#placement-price').textContent = price;
    }
    if (tool === 'noStoppingZone') this.el['tool-details'].querySelector('#zone-length').value = options.length + ' m';
    if (tool === 'signalTiming') {
      const diagram = this.el['tool-details'].querySelector('.phase-diagram');
      const plan = normalizeSignalPlan(options.plan);
      const planKey = JSON.stringify(plan);
      if (diagram.dataset.plan !== planKey) {
        diagram.dataset.plan = planKey;
        this.el['tool-details'].querySelector('#cycle-length').value = plan.cycle + ' s';
        for (const arm of SIGNAL_ARM_IDS) this.el['tool-details'].querySelector('[data-green="' + arm + '"]').value = plan.greens[arm].toFixed(1) + ' s';
        diagram.innerHTML = SIGNAL_ARM_IDS.map(arm => '<i class="' + arm + '" style="flex:' + plan.greens[arm] + '" title="' + ARM[arm] + ' green"></i><i class="amber-segment" style="flex:' + SIGNAL.amber + '"></i><i class="red-segment" style="flex:' + SIGNAL.allRed + '"></i>').join('');
      }
    }
  }

  notice(text, now) {
    this.el.notice.textContent = text;
    this.el.notice.hidden = false;
    this.noticeUntil = now + 3800;
  }

  update(world, now, force = false) {
    if (this.noticeUntil <= now) this.el.notice.hidden = true;
    if (!force && now < (this.nextUpdate ?? 0)) return;
    this.nextUpdate = now + 235;
    const { run } = this;
    const { metrics: m, state } = run.sim;
    const base = run.baseline.metrics;
    const time = state.time;
    this.el['sim-clock'].textContent = clock(time);
    this.el['results-button'].disabled = !run.started;
    const tunnelButton = this.el['stage-info'].querySelector('#tunnel-xray');
    if (tunnelButton) tunnelButton.setAttribute('aria-pressed', String(world.tunnel.enabled));
    const runBtn = this.el['run-button'];
    runBtn.hidden = run.speed > 0;
    runBtn.querySelector('span').textContent = time > 0 ? 'Resume' : 'Run';
    for (const [key, index] of [['time-saved', 1], ['time-saved-long', 2]]) {
      const main = this.el[key], sub = this.el[key + '-sub'];
      if (time < 5) { main.textContent = 'Press Run'; main.className = ''; sub.textContent = ''; continue; }
      if (time < 120) { main.textContent = 'Measuring…'; main.className = ''; sub.textContent = 'needs 2 simulated minutes'; continue; }
      const sv = savings(run.sims[index], run.baseline);
      main.textContent = number(Math.abs(sv.personHoursSaved * 60), 0) + ' person-min ' + (sv.personHoursSaved >= 0 ? 'saved' : 'lost');
      main.className = sv.personHoursSaved > 0.01 ? 'good' : sv.personHoursSaved < -0.01 ? 'bad' : '';
      sub.textContent = signed(-sv.percentDelay, 0) + '% delay · ' + number(Math.abs(sv.secondsPerPerson), 1) + ' s/traveller';
      const label = this.el['saved-' + PLANS[index].id];
      if (label) { label.textContent = signed(-sv.percentDelay, 0) + '%'; label.className = 'step-saved ' + main.className; }
    }
    if (!this.el.ghost.hidden) {
      this.el['ghost-deltas'].innerHTML = '<span>' + signed(m.personsPerHour - base.personsPerHour) + ' people/h</span><span>' + signed(m.meanDelay - base.meanDelay, 1) + ' s delay</span><span>' + signed(m.unsafeCrossings - base.unsafeCrossings) + ' conflicts</span>';
    }
    this.el.metrics.innerHTML = [
      ['People / hour', number(m.personsPerHour)], ['Mean delay', number(m.meanDelay, 1) + ' s'],
      ['Curb blocked', number(m.curbBlockedSeconds) + ' lane-s'], ['Unsafe crossings', m.unsafeCrossings],
    ].map(([label, value]) => '<div><strong>' + value + '</strong><small>' + label + '</small></div>').join('');
    if (this.el['more-metrics'].parentElement.open) {
      this.el['more-metrics'].innerHTML = [
        ['Vehicles / hour', number(m.vehiclesPerHour)], ['95th percentile delay', number(m.p95Delay, 1) + ' s'],
        ['Person-delay', number(m.personDelay) + ' person-s'], ['Transit passenger delay', number(m.busPassengerDelay) + ' person-s'],
        ['Mean pedestrian wait', number(m.meanPedestrianWait, 1) + ' s'], ['Added walking', number(m.addedWalkingDistance) + ' passenger-m'],
        ['Idle CO₂ estimate', number(m.idleCO2Kg, 2) + ' kg'], ['Cost spent', npr(m.costSpent)],
        ...ARM_IDS.map(arm => [abbreviations[arm] + ' queue', number(m.queueMetersByArm[arm]) + ' m · ' + m.queueByArm[arm] + ' vehicles']),
      ].map(([label, value]) => '<p>' + label + '<strong>' + value + '</strong></p>').join('');
    }
    if (run.advice[0] !== this.lastAdvice) {
      this.lastAdvice = run.advice[0];
      this.el.advice.innerHTML = run.advice.slice(0, 6).map(({ message, time }) => '<p><time>' + clock(time) + '</time><span>' + escapeHTML(message) + '</span></p>').join('');
    }
    const vehicle = world.selected;
    this.el['vehicle-inspector'].hidden = !vehicle;
    if (vehicle) {
      const route = ARM[vehicle.arm] + ' to ' + ARM[vehicle.destination] + ' · ' + vehicle.turn;
      this.el['vehicle-inspector'].innerHTML = '<div class="panel-head"><h2>Vehicle details</h2>' + icon('target') + '</div><strong>' + VEHICLE[vehicle.type] + ' · ' + escapeHTML(vehicle.plate) + '</strong><p>' + route + '</p><p>' + number(vehicle.delay, 1) + ' s accrued delay</p>';
      world.selection.textContent = vehicle.plate;
    }
    if (!this.el.charts.hidden) this.drawChart(force);
  }

  renderChanges() {
    const { run } = this;
    const key = run.plan.map(entry => entry.id).join(',') + '|' + run.started;
    if (this.planKey === key) return;
    this.planKey = key;
    if (!run.plan.length) {
      this.el.changes.innerHTML = '<p class="empty">No changes yet. This run shows today\'s junction.</p>';
      return;
    }
    this.el.changes.innerHTML = run.plan.map(({ input, id }, i) => {
      const where = input.arm ? ' · ' + ARM[input.arm] + (input.distance != null ? ' · ' + Math.round(Math.abs(input.distance)) + ' m' + (input.side === 'far' ? ' far side' : '') : '') : '';
      return '<article class="change-card"><header><span>' + (i + 1) + '</span><strong>' + escapeHTML(toolName(input.type) + where) + '</strong>' +
        '<button type="button" data-remove="' + id + '" title="Remove from plan" aria-label="Remove ' + toolName(input.type) + '">' + icon('undo') + '</button></header>' +
        '<small class="change-status">est. ' + npr(TOOLS[input.type === 'zebra' && input.signal ? 'pedestrianSignal' : input.type]?.cost ?? 0) + '</small></article>';
    }).join('') + '<p class="log-note">Estimated cost of plan: <strong>' + npr(run.plan.reduce((sum, { input }) => sum + (TOOLS[input.type]?.cost ?? 0), 0)) + '</strong> (illustrative).</p>';
  }

  drawChart(force) {
    const series = this.run.charts;
    const canvas = this.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const elapsed = series.at(-1)[0];
    if (!w || !h || !force && this.chartTime === elapsed && this.chartWidth === w) return;
    this.chartTime = elapsed;
    this.chartWidth = w;
    const dpr = Math.min(2, devicePixelRatio);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const left = 90;
    const right = w - 12;
    const bottom = h - 20;
    const tickStep = Math.max(60, Math.ceil(elapsed / 240) * 60);
    const end = Math.max(tickStep, Math.ceil(elapsed / tickStep) * tickStep);
    let max = 1;
    for (const point of series) for (let k = 1; k < point.length; k++) max = Math.max(max, point[k] * 1.08);
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#c4d0de';
    ctx.fillText('Total delay', 5, 14);
    ctx.fillText('person-min', 5, 28);
    ctx.font = '10px system-ui';
    ctx.fillText(Math.round(max).toLocaleString(), 5, 44);
    ctx.strokeStyle = '#344252';
    ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    PLANS.forEach((plan, k) => {
      ctx.beginPath();
      ctx.strokeStyle = plan.colour;
      ctx.lineWidth = 2.2;
      for (const [j, point] of series.entries()) {
        const x = left + point[0] / end * (right - left);
        const y = bottom - point[k + 1] / max * (bottom - 8);
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = plan.colour;
      ctx.fillText('● ' + plan.name, 5, 62 + k * 14);
    });
    ctx.fillStyle = '#9dacc0';
    for (let time = 0; time <= end; time += tickStep) {
      ctx.textAlign = time === end ? 'right' : 'center';
      ctx.fillText(time / 60 + 'm', left + time / end * (right - left), h - 6);
    }
  }
}
