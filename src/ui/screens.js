import audit from '../../data/valley-audit.json';
import photos from '../../references/README.md?raw';
import { DEMAND, DRIVER, NETWORK, PED, PLATES, SIGNAL, TOOLS, TRANSIT, VEHICLES } from '../sim/params.js';
import { LEVELS } from '../game/levels.js';
import { clock, signed } from '../game/tools.js';
import { PLANS } from '../game/plans.js';
import effects from '../../data/measure-effects.json';
import { icon } from './icons.js';

export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const osm = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors (ODbL)</a>';
export const brand = '<span class="brand-mark">' + icon('brand') + '</span><span>ROKNE THAU<small>KOTESHWOR CHOWK</small></span>';
export const number = (value, digits = 0) => value.toLocaleString('en', { maximumFractionDigits: digits });
const legendDot = color => '<i class="dot ' + color + '"></i>';

export function titleScreen(ready) {
  return `<main class="title-screen">
    <header class="title-top"><div class="wordmark">${brand}</div><button type="button" class="muter" data-action="mute">${icon('volume')}<span>Sound on</span></button></header>
    <div class="title-content">
      <p class="eyebrow"><span></span>KATHMANDU, NEPAL</p>
      <h1>Rokne<br>Thau<span>.</span></h1>
      <p class="subtitle">Koteshwor Chowk</p>
      <p class="title-copy">A traffic simulator for the real Koteshwor junction. Watch it run today, then with short-term low-cost fixes, then with a long-term tunnel, all on identical traffic, and see how much time each one saves.</p>
      <button type="button" class="primary start-button" data-screen="levels" ${ready ? '' : 'disabled'}>${icon('play')} Open the simulator</button>
      <nav class="title-nav" aria-label="Explore"><button data-action="open-guide">${icon('layers')} Plan guide</button><button data-screen="audit">${icon('map')} Valley audit</button><button data-screen="how">${icon('info')} How it works</button><button data-screen="credits">Credits</button></nav>
      <p class="load-status" id="load-status" role="status">${ready ? '' : 'Loading the 3D junction…'}</p>
    </div>
    <footer class="title-bottom"><span class="live-label">${legendDot('green')} Live junction simulation</span><span>27.6786° N &nbsp; 85.3495° E · ${osm}</span></footer>
  </main>`;
}

function shell(title, kicker, intro, body, back = '<button type="button" data-screen="title">' + icon('back') + ' Home</button>') {
  return `<main class="page-screen"><header class="page-top">
    <button type="button" class="wordmark" data-screen="title" aria-label="Rokne Thau home">${brand}</button>
    ${back}
    </header><div class="page-inner"><p class="eyebrow"><span></span>${kicker}</p><h1 tabindex="-1">${title}</h1><p class="page-intro">${intro}</p>${body}</div>
  </main>`;
}

export function levelsScreen() {
  const tags = ['PEAK', 'TRANSIT', 'WEATHER', 'FESTIVAL', 'OFF-PEAK'];
  const accents = ['#ef4665', '#f5a970', '#74baf8', '#eec36a', '#8ed7b0'];
  return shell('Choose traffic conditions', 'KOTESHWOR CHOWK', 'Pick the traffic conditions for all three plans. Run the simulation for as long as you like and open Results at any time after it starts.',
    '<div class="level-grid">' + LEVELS.map(level => `<article class="level-card" style="--level-accent:${accents[level.index]}">
      <header><span>${tags[level.index]}</span></header>
      <h2>${level.name}</h2><p>${level.description}</p>
      <footer><span>${Object.values(level.demand).reduce((sum, arm) => sum + arm.vehiclesPerHour, 0).toLocaleString('en')} vehicles/h</span><button class="primary" data-level="${level.id}">${icon('play')} Open <span class="sr-only">${level.name}</span></button></footer>
    </article>`).join('') + '</div><p class="attribution">' + osm + '</p>');
}

function photoCredits() {
  return '<ul class="photo-list">' + photos.split('\n').filter(line => line.startsWith('| [')).map(line => {
    const cells = line.split('|').map(cell => cell.trim());
    const name = cells[2];
    const url = cells[5].match(/\((https:\/\/[^)]+)\)/)?.[1];
    return '<li><strong>' + escapeHTML(name) + '</strong><span>' + escapeHTML(cells[3] + ' · ' + cells[4]) + ' · <a href="' + escapeHTML(url) + '" target="_blank" rel="noopener">Wikimedia Commons</a></span></li>';
  }).join('') + '</ul>';
}

export function howScreen() {
  const blocks = [
    ['Sourced geometry', 'OSM supplies road alignments, mapped bus stops, crossing locations and available building footprints. OSM lane counts and widths are used where available. Lane centring, stop-line setbacks and the assumed Seti O.P. Marg give-way operation simplify the real junction. Seventy-five procedural frontage buildings and the wider city fabric are illustrative.'],
    ['Vehicles and demand · assumed', 'The morning streams supply ' + DEMAND.morning.rates.join(' / ') + ' vehicles per hour on the north, southwest, Araniko and Seti approaches respectively. Motorcycles account for ' + Math.round(VEHICLES.motorcycle.share * 100) + '% of the default mix. Occupancies, boarding counts, rain effects, routing fractions and ' + PLATES.zones[0] + '-style plates are game assumptions. Unmapped arms receive an assumed stop ' + TRANSIT.informalRange[1] + ' m upstream.'],
    ['Driver behaviour · model and assumptions', 'The game uses an Intelligent Driver Model-style following rule with the canonical exponent of ' + DRIVER.exponent + ' and an assumed ' + DRIVER.headway + ' s time gap. It uses left-hand traffic and assumed lane widths up to ' + NETWORK.usableWidth + ' m. Motorcycle filtering, lane changes and gap acceptance are simplified.'],
    ['Signals and pedestrians · assumed', 'The initial phase plan uses a ' + SIGNAL.cycle + ' s cycle, ' + SIGNAL.amber + ' s amber and ' + SIGNAL.allRed + ' s all-red between three main approaches. Pedestrians walk at ' + PED.crossingSpeed + ' m/s. Zebra yielding is assumed at ' + Math.round(PED.zebraYield * 100) + '% when a waiting pedestrian attempts to assert priority.'],
    ['Tool effects · assumed', 'No-stopping compliance starts at ' + TOOLS.noStoppingZone.compliance * 100 + '%. An officer can cut the remaining non-compliance by ' + Math.round(TOOLS.policeOfficer.compliance * 100) + '% locally and a campaign by ' + Math.round(TOOLS.infoCampaign.compliance * 100) + '% across the junction. These factors combine multiplicatively. Moving a stop changes its location and eligible routes. Costs are illustrative estimates only and do not limit the plan.'],
    ['Reading the results', 'Now, Short-term, and Long-term run side by side with the same seeded demand. Results cover the elapsed simulation time when you open them. Total delay includes vehicle occupants on active trips and pedestrians waiting to cross. Mean and 95th percentile vehicle delay use completed trips. Queue length measures how far the queue extends along each approach. Idle CO₂ uses assumed per-vehicle idle rates.'],
    ['What this model doesn’t capture', 'The model omits network-wide rerouting, field-observed signal plans, real driver responses, exact walking routes, bus timetables, crash probabilities and emissions while moving. Crossing conflicts and audit distances are screening indicators. Delay-cause estimates classify simulated braking and propagate the classification through waiting vehicles. Change-log windows may overlap.'],
  ];
  return shell('How it works', 'MODEL NOTES', 'Inputs, assumptions and limits of the junction simulation.',
    '<nav class="page-actions"><button data-action="open-guide">' + icon('layers') + ' Plan guide</button></nav>' +
    '<div class="content-grid">' + blocks.map(([name, content]) => '<article class="paper"><h2>' + name + '</h2><p>' + content + '</p></article>').join('') +
      '<article class="paper"><h2>Map and photo references</h2><p>' + osm + '</p><details><summary>Photo credits</summary>' + photoCredits() + '</details></article></div>');
}

export const benchmarkWindow = effects.seeds.length + ' runs of ' + effects.minutes + ' simulated minutes';
export const delayEffect = saved => {
  const amount = Math.round(Math.abs(saved));
  return amount === 0 ? 'Under 1 person-min of change' : number(amount) + ' person-min ' + (saved > 0 ? 'saved' : 'added');
};

function guideBenchmark(condition) {
  const { plans } = effects.conditions[condition];
  return PLANS.map(plan => {
    const stats = plans[plan.id];
    return `<div style="--plan:${plan.colour}"><h3>${plan.name}</h3>
      <strong>${plan.id === 'now' ? number(stats.delay) + ' person-min of delay' : delayEffect(stats.saved)}</strong>
      <small>${number(stats.unsafe, 1)} modeled unsafe crossings on average</small></div>`;
  }).join('');
}

export function guideScreen(condition, origin) {
  const sections = PLANS.slice(1).map(plan => `
    <section class="guide-section" id="guide-${plan.id}" style="--plan:${plan.colour}" aria-labelledby="guide-heading-${plan.id}">
      <header class="guide-section-head"><h2 id="guide-heading-${plan.id}" tabindex="-1">${plan.name} <span>${plan.short}</span></h2><p>${plan.summary}</p></header>
      <div class="guide-measures">${plan.measures.map(measure => `
        <article class="paper guide-measure">
          <h3><span>${icon(measure.icon)}</span>${measure.name}</h3>
          <dl>
            <div><dt>Modeled change</dt><dd>${measure.model}</dd></div>
            <div><dt>What to watch</dt><dd>${measure.watch}</dd></div>
            <div><dt>What to verify on site</dt><dd>${measure.next}</dd></div>
          </dl>
          <p class="guide-effect">On its own <strong data-guide-measure="${measure.name}">${delayEffect(effects.conditions[condition].measures[measure.name].saved)}</strong></p>
        </article>`).join('')}</div>
    </section>`).join('');
  const backLabel = { game: 'Back to simulation', report: 'Back to results', how: 'Back to model notes' }[origin];
  const back = backLabel ? '<button data-action="close-guide">' + icon('back') + ' ' + backLabel + '</button>' : undefined;
  const start = backLabel ? back : '<button class="primary" data-screen="levels">' + icon('play') + ' Choose traffic conditions</button>';
  return shell('Koteshwor plan guide', 'ROKNE THAU', 'Explore the junction as modeled today and see how each proposed change works, what the simulation found, and what still needs to be checked on site.',
    `<nav class="guide-jumps" aria-label="Jump to a plan">${PLANS.map(plan => `<button data-guide-jump="${plan.id}" style="--plan:${plan.colour}">${plan.name}</button>`).join('')}</nav>
    <section class="paper guide-baseline" aria-labelledby="guide-heading-now">
      <h2 id="guide-heading-now" tabindex="-1">Now <span>Modeled baseline</span></h2>
      <p>${PLANS[0].summary} Road alignments and mapped features come from OpenStreetMap. Traffic demand, timings and driver behavior are assumptions.</p>
      <p>The simulator already runs both packages on the same seeded demand in five traffic conditions. Its 3D view shows boarding, queues, surface crossings, skybridges and a tunnel cutaway. The packages are modeled proposals.</p>
    </section>
    <section class="paper guide-benchmark" aria-labelledby="guide-benchmark-title">
      <header><h2 id="guide-benchmark-title">Compare the packages</h2>
        <label for="guide-condition">Traffic condition</label><select id="guide-condition">${LEVELS.map(level =>
          `<option value="${level.id}" ${level.id === condition ? 'selected' : ''}>${level.name}</option>`).join('')}</select></header>
      <p>Average from ${benchmarkWindow}. One person-minute is one minute of delay for one person. Package and individual results use Now as the baseline. Package results include interactions between measures.</p>
      <div class="guide-benchmark-grid" id="guide-benchmark-values" aria-live="polite">${guideBenchmark(condition)}</div>
    </section>
    ${sections}
    <section class="paper guide-earlier"><h2>Earlier experiments</h2>
      <details><summary>Other ideas explored in the simulator</summary>
        <dl>
          <div><dt>Far-side stops</dt><dd>Move boarding past the junction for routes that use that exit. A queue behind a stopped bus can reach back into the junction.</dd></div>
          <div><dt>No-stopping zones, traffic officers and public campaigns</dt><dd>Zones move complying drivers away from a marked curb. Officers raise local compliance and can direct phases. A campaign reduces informal stopping across the junction.</dd></div>
          <div><dt>Manual timing and free left turns</dt><dd>Adjust cycle lengths and green shares, or change which left turns can proceed outside the normal signal phase.</dd></div>
          <div><dt>Unsignalized zebra crossings</dt><dd>Drivers can yield when a pedestrian has been waiting. The short-term package instead models marked crossings with a walk phase.</dd></div>
          <div><dt>Pedestrian underpasses</dt><dd>An earlier option routed people below traffic. The long-term package models stair-access skybridges.</dd></div>
        </dl>
      </details>
    </section>
    <nav class="report-actions" aria-label="Continue exploring">${start}${backLabel ? '' : '<button data-screen="how">' + icon('info') + ' Model notes</button>'}</nav>
    <p class="attribution">${osm}</p>`, back);
}

export function updateGuideBenchmark(condition) {
  document.querySelector('#guide-benchmark-values').innerHTML = guideBenchmark(condition);
  for (const label of document.querySelectorAll('[data-guide-measure]')) {
    label.textContent = delayEffect(effects.conditions[condition].measures[label.dataset.guideMeasure].saved);
  }
}

export function creditsScreen() {
  return shell('Credits', 'ROKNE THAU', 'A browser traffic simulator for Koteshwor Chowk, Kathmandu.',
    '<div class="paper"><h2>Map data</h2><p>' + osm + '</p><p>Junction geometry and Valley audit inputs are derived from OpenStreetMap via Overpass. The audit uses a local map projection and the stop and road extracts included with the game.</p></div>' +
    '<div class="paper"><h2>Street and vehicle references</h2><p>Wikimedia Commons photographs informed the street scene, vehicle models and city atmosphere.</p>' + photoCredits() + '</div>');
}

export function auditScreen() {
  const [x, y, right, bottom] = audit.bounds;
  const roadPaths = ['secondary', 'primary', 'trunk'].map(type => '<path class="audit-road ' + type + '" d="' + audit.roads.filter(road => road.class === type).map(road => 'M' + road.points.map(point => point.join(',')).join('L')).join('') + '"/>').join('');
  const dots = [...audit.stops].reverse().map(stop =>
    `<circle class="audit-dot ${stop.band}" data-stop-dot="${stop.id}" cx="${stop.point[0]}" cy="${stop.point[1]}" r="59"><title>${escapeHTML(stop.name)} · ${stop.distance} m to nearest ${stop.nearest.kind}</title></circle>`).join('');
  const rows = audit.stops.slice(0, 20).map((stop, index) =>
    `<li><button type="button" data-audit-stop="${stop.id}"><span class="rank">${String(index + 1).padStart(2, '0')}</span><span class="stop-name">${escapeHTML(stop.name)}<small>${stop.nearest.kind}</small></span><strong class="${stop.band}">${stop.distance} m</strong></button></li>`).join('');
  return shell('Valley audit', 'KATHMANDU VALLEY', 'How close are mapped bus stops to signals and major junctions? Explore a distance-based screen for possible curb conflicts.',
    `<div class="audit-grid"><section class="paper audit-map"><header><h2>Mapped bus stops</h2><p>${audit.stops.length} stops · ${audit.signals} signals · ${audit.junctions.length} major junctions</p></header>
    <svg id="audit-svg" viewBox="${x} ${y} ${right - x} ${bottom - y}" aria-label="Map of mapped stops and major roads in the Kathmandu Valley">
      ${roadPaths}${dots}
      <g class="playable-point" role="button" tabindex="0" aria-label="Koteshwor Playable" data-screen="levels">
        <circle r="285" class="halo"/><circle r="119"/><path d="M180 -40H410L570 -240"/><text x="655" y="-202">Koteshwor</text><text class="map-tag" x="655" y="19">PLAYABLE</text>
      </g>
    </svg><div class="audit-legend"><span>${legendDot('red')} Under ${audit.thresholds.red} m</span><span>${legendDot('amber')} ${audit.thresholds.red}–${audit.thresholds.amber} m</span><span>${legendDot('grey')} ${audit.thresholds.amber} m or more</span></div>
    <p class="map-selection" id="audit-selection" aria-live="polite">Select a stop to locate it on the map.</p>
    <button class="primary" data-screen="levels">${icon('play')} Simulate Koteshwor</button>
    <p class="attribution">${osm}</p></section>
    <section class="paper audit-list"><h2>20 closest stops</h2><p>Ranked by distance to a signal or a major-road junction.</p><ol>${rows}</ol></section></div>
    <p class="method">Distances are straight-line metres. The audit defines a major junction as an OSM node with at least three connections on mapped trunk, primary or secondary roads. The colour bands are assumed screening thresholds.</p>`);
}

export function reportScreen(run, r) {
  const { level } = run;
  const [now, short, long] = r.plans;
  const avg = effects.conditions[level.id];
  const cols = r.plans.map(p => p.metrics);
  const row = (label, pick, unit, higherIsBetter = false, digits = 0) => {
    const base = pick(cols[0]);
    return '<tr><th scope="row">' + label + '</th>' + cols.map((m, i) => {
      const v = pick(m), d = v - base, delta = signed(d, digits);
      const cls = !i || delta === '0' ? '' : (higherIsBetter ? d > 0 : d < 0) ? 'good' : 'bad';
      return '<td class="' + cls + '">' + number(v, digits) + unit + (cls ? '<small> ' + delta + '</small>' : '') + '</td>';
    }).join('') + '</tr>';
  };
  const table = '<table class="compare-table"><thead><tr><th></th>' + r.plans.map(p => '<th style="color:' + p.plan.colour + '">' + p.plan.name + '</th>').join('') + '</tr></thead><tbody>' +
    row('Total delay (people in vehicles + on foot)', m => (m.personDelay + m.pedestrianWaitSeconds) / 60, ' person-min', false, 1) +
    row('People through', m => m.personsPerHour, ' /h', true) +
    row('Vehicles through', m => m.vehiclesPerHour, ' /h', true) +
    row('Mean delay per completed trip', m => m.meanDelay, ' s', false, 1) +
    row('Bus & microbus passenger delay', m => m.busPassengerDelay / 60, ' person-min') +
    row('Lane blocked by boarding buses', m => m.curbBlockedSeconds, ' lane-s') +
    row('Unsafe pedestrian crossings', m => m.unsafeCrossings, '') +
    row('Mean pedestrian wait', m => m.meanPedestrianWait, ' s', false, 1) +
    row('Idle CO₂ (estimate)', m => m.idleCO2Kg, ' kg', false, 1) + '</tbody></table>';
  const card = p => {
    const a = avg.plans[p.plan.id];
    const saved = Math.round(p.personHoursSaved * 60);
    const result = delayEffect(p.personHoursSaved * 60);
    return '<article class="paper result-card" style="--plan:' + p.plan.colour + '"><p class="eyebrow">' + p.plan.name.toUpperCase() + ' · ' + p.plan.short + '</p><h2 class="' + (saved > 0 ? 'good' : saved < 0 ? 'bad' : '') + '">' +
      result + '</h2>' + (r.elapsed < 120 ? '<p>Early snapshot. Each benchmark run covers ' + effects.minutes + ' simulated minutes.</p>' :
        '<p>' + signed(-p.percentDelay, 0) + '% delay vs Now' +
        (now.metrics.persons ? ' · ' + number(Math.abs(p.secondsPerPerson), 1) + ' s per traveller' : '') + '</p>') +
      '<p><small>Benchmark average over ' + benchmarkWindow + ' · ' + delayEffect(a.saved) + '. Results ranged from ' +
        delayEffect(a.savedMin) + ' to ' + delayEffect(a.savedMax) + '.</small></p>' +
      (r.elapsed >= 120 && Math.abs(p.peakHoursSaved) > 0.05 ? '<p><small>Rough scale-up to a 2-hour peak: about ' + number(Math.abs(p.peakHoursSaved), 0) + ' person-hours ' + (p.peakHoursSaved >= 0 ? 'saved' : 'lost') + ' per peak at this junction. Order of magnitude only.</small></p>' : '') +
      '<details><summary>What this package changes</summary><p>' + p.plan.summary + '</p><ul class="measure-list">' +
      p.plan.measures.map(measure => '<li><strong>' + measure.name + '</strong><span>' + measure.model + '</span><em>On its own · ' +
        delayEffect(avg.measures[measure.name].saved) + ' on average</em></li>').join('') + '</ul></details></article>';
  };
  return shell(level.name, 'RESULTS · ' + clock(r.elapsed) + ' ELAPSED', 'Compare the three plans from the start of this run to the time you opened Results.',
    '<nav class="page-actions"><button data-action="open-guide">' + icon('layers') + ' Plan guide</button></nav>' +
    '<div class="content-grid report-grid">' + card(short) + card(long) + '</div>' +
    '<article class="paper"><h2>Side by side</h2>' + table + '</article>' +
    '<article class="paper"><h2>Reading the comparison</h2><p>One person-minute is one minute of delay for one person. Total delay counts vehicle occupants and pedestrian waiting. A plan can reduce unsafe crossings and still increase delay. Those crossing counts are simulated conflict indicators. The Plan guide explains the trade-offs for each measure.</p></article>' +
    '<nav class="report-actions"><button class="primary" data-action="return-to-run">' + icon('back') + ' Back to simulation</button><button data-action="rerun-plan">Restart run</button><button data-screen="levels">Other traffic conditions</button></nav><p class="attribution">' + osm + '</p>');
}

export function selectAuditStop(id) {
  const stop = audit.stops.find(entry => entry.id === Number(id));
  if (!stop) return;
  document.querySelector('#audit-svg .selected')?.classList.remove('selected');
  document.querySelector('[data-stop-dot="' + stop.id + '"]')?.classList.add('selected');
  const selection = document.querySelector('#audit-selection');
  selection.textContent = stop.name + ' · ' + stop.distance + ' m to nearest ' + stop.nearest.kind;
}
