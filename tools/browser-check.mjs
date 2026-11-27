import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const shots = resolve(process.env.SCREENSHOT_DIR ?? fileURLToPath(new URL('../logs/shots/', import.meta.url)));
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const monitor = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
};
const screenshot = (page, name) => page.screenshot({ path: resolve(shots, name + '.png'), fullPage: true, animations: 'disabled' });
const visible = locator => locator.waitFor({ state: 'visible' });
let desktop;
try {
  desktop = await browser.newPage({ viewport: { width: 1350, height: 840 }, deviceScaleFactor: 1 });
  monitor(desktop);
  await desktop.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      return getContext.call(this, type, type === 'webgl2' ? { ...attributes, preserveDrawingBuffer: true } : attributes);
    };
  });
  await desktop.goto(url, { waitUntil: 'domcontentloaded' });
  await desktop.waitForFunction(() => !document.querySelector('.start-button')?.disabled && document.querySelector('#scene').width > 500, null, { timeout: 90_000 });
  const colors = await desktop.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const canvas = document.querySelector('#scene');
    const sample = document.createElement('canvas');
    sample.width = 48;
    sample.height = 32;
    const context = sample.getContext('2d');
    context.drawImage(canvas, 0, 0, 48, 32);
    const bytes = context.getImageData(0, 0, 48, 32).data;
    const palette = new Set();
    for (let i = 0; i < bytes.length; i += 4) palette.add((bytes[i] >> 3) + ',' + (bytes[i + 1] >> 3) + ',' + (bytes[i + 2] >> 3));
    return palette.size;
  });
  assert.ok(colors > 24, 'Expected a varied WebGL scene, received ' + colors + ' colour bins');
  await screenshot(desktop, '01-title');
  console.log('Rendered WebGL title (' + colors + ' colour bins).');

  await desktop.getByRole('button', { name: 'Plan guide', exact: true }).click();
  await visible(desktop.getByRole('heading', { name: 'Koteshwor plan guide' }));
  assert.equal(await desktop.locator('#guide-short .guide-measure').count(), 5);
  assert.equal(await desktop.locator('#guide-long .guide-measure').count(), 4);
  const initialBenchmark = await desktop.locator('#guide-benchmark-values').textContent();
  const initialMeasure = await desktop.locator('#guide-short [data-guide-measure]').first().textContent();
  await desktop.getByLabel('Traffic condition').selectOption('rain');
  assert.notEqual(await desktop.locator('#guide-benchmark-values').textContent(), initialBenchmark);
  assert.notEqual(await desktop.locator('#guide-short [data-guide-measure]').first().textContent(), initialMeasure);
  await desktop.getByRole('button', { name: 'Long-term', exact: true }).click();
  assert.equal(await desktop.locator(':focus').getAttribute('id'), 'guide-heading-long');
  await screenshot(desktop, '08-plan-guide');
  await desktop.getByRole('button', { name: 'Home', exact: true }).click();

  await desktop.getByRole('button', { name: 'Open the simulator' }).click();
  assert.equal(await desktop.locator('.level-card').count(), 5);
  await screenshot(desktop, '02-levels');
  await desktop.getByRole('button', { name: 'Open Morning rush' }).click();
  const results = desktop.getByRole('button', { name: 'Results', exact: true });
  assert.ok(await results.isDisabled());
  await desktop.locator('[data-view="2"]').click();
  assert.equal(await desktop.locator('#sim-clock').textContent(), '0:00');
  await desktop.getByRole('button', { name: 'Run', exact: true }).click();
  await desktop.getByRole('button', { name: '8× speed' }).click();
  await desktop.getByRole('button', { name: 'Bird', exact: true }).click();
  const cutaway = desktop.getByRole('button', { name: 'Tunnel cutaway' });
  await cutaway.click();
  assert.equal(await cutaway.getAttribute('aria-pressed'), 'false');
  await visible(desktop.locator('.skybridge-label'));
  await desktop.waitForFunction(() => document.querySelectorAll('.portal-label:not([hidden])').length === 0);
  await cutaway.click();
  assert.equal(await cutaway.getAttribute('aria-pressed'), 'true');
  await desktop.waitForFunction(() => document.querySelectorAll('.portal-label:not([hidden])').length === 2);
  await desktop.getByRole('button', { name: 'Charts' }).click();
  await visible(desktop.locator('#ghost-viewport'));
  await visible(desktop.locator('#chart-canvas'));
  await desktop.waitForFunction(() => document.querySelector('#sim-clock').textContent !== '0:00');
  await desktop.getByRole('button', { name: 'Pause', exact: true }).click();
  const elapsed = await desktop.locator('#sim-clock').textContent();
  await desktop.getByRole('button', { name: 'Plan guide', exact: true }).click();
  assert.equal(await desktop.getByLabel('Traffic condition').inputValue(), 'morning');
  await desktop.getByRole('button', { name: 'Back to simulation', exact: true }).first().click();
  assert.equal(await desktop.locator('#sim-clock').textContent(), elapsed);
  assert.equal(await cutaway.getAttribute('aria-pressed'), 'true');
  await screenshot(desktop, '03-tunnel');
  await results.click();
  await visible(desktop.getByText('RESULTS · ' + elapsed + ' ELAPSED', { exact: true }));
  assert.deepEqual(await desktop.locator('.compare-table thead th').allTextContents(), ['', 'Now', 'Short-term', 'Long-term']);
  await desktop.getByRole('button', { name: 'Plan guide', exact: true }).click();
  await desktop.getByRole('button', { name: 'Back to results', exact: true }).first().click();
  await visible(desktop.getByText('RESULTS · ' + elapsed + ' ELAPSED', { exact: true }));
  await screenshot(desktop, '04-report');
  await desktop.getByRole('button', { name: 'Back to simulation' }).click();
  assert.equal(await desktop.locator('#sim-clock').textContent(), elapsed);
  assert.equal(await desktop.locator('[data-view="2"]').getAttribute('aria-pressed'), 'true');
  await desktop.getByRole('button', { name: 'Resume', exact: true }).click();
  await desktop.waitForFunction(time => document.querySelector('#sim-clock').textContent !== time, elapsed);
  await desktop.getByRole('button', { name: 'Results', exact: true }).click();


  await desktop.getByRole('button', { name: 'Home', exact: true }).click();
  await desktop.getByRole('button', { name: 'Valley audit' }).click();
  assert.equal(await desktop.locator('.audit-list li').count(), 20);
  assert.ok(await desktop.locator('#audit-svg .audit-dot').count() > 200);
  await desktop.locator('[data-audit-stop]').first().click();
  assert.equal(await desktop.locator('.audit-dot.selected').count(), 1);
  await screenshot(desktop, '05-audit');
  await desktop.getByRole('button', { name: 'Koteshwor Playable', exact: true }).click();
  await visible(desktop.getByRole('heading', { name: 'Choose traffic conditions' }));

  await desktop.getByRole('button', { name: 'Home', exact: true }).click();
  await desktop.getByRole('button', { name: 'How it works' }).click();
  await visible(desktop.getByRole('heading', { name: 'Sourced geometry' }));
  await screenshot(desktop, '06-model');
  await desktop.getByRole('button', { name: 'Home', exact: true }).click();
  await desktop.getByRole('button', { name: 'Credits', exact: true }).click();
  assert.ok(await desktop.getByRole('link', { name: 'Wikimedia Commons' }).count() >= 12);
  await desktop.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  monitor(phone);
  const noOverflow = async () => {
    const dimensions = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(dimensions[0] <= dimensions[1], 'Horizontal overflow: ' + dimensions.join(' > '));
  };
  await phone.goto(url, { waitUntil: 'domcontentloaded' });
  await phone.getByRole('button', { name: 'Open the simulator' }).click({ timeout: 90_000 });
  await noOverflow();
  await phone.getByRole('button', { name: 'Open Morning rush' }).tap();
  const mobileTools = phone.getByRole('button', { name: 'Plans', exact: true });
  await visible(mobileTools);
  assert.ok(await phone.locator('#tools-panel').isHidden());
  await mobileTools.tap();
  assert.ok((await phone.locator('#tools-panel').boundingBox()).width >= 240);
  await phone.locator('[data-view="2"]').tap();
  const phoneCutaway = phone.getByRole('button', { name: 'Tunnel cutaway' });
  await phoneCutaway.tap();
  assert.equal(await phoneCutaway.getAttribute('aria-pressed'), 'false');
  await phoneCutaway.tap();
  await noOverflow();
  await phone.getByRole('button', { name: 'Plan guide', exact: true }).tap();
  await visible(phone.getByRole('heading', { name: 'Koteshwor plan guide' }));
  await phone.getByRole('button', { name: 'Short-term', exact: true }).tap();
  await noOverflow();
  await screenshot(phone, '09-phone-plan-guide');
  await phone.getByRole('button', { name: 'Back to simulation', exact: true }).first().tap();
  await visible(phoneCutaway);
  await screenshot(phone, '07-phone');
  await mobileTools.tap();
  await phone.getByRole('button', { name: 'Run', exact: true }).tap();
  await phone.getByRole('button', { name: 'Results', exact: true }).tap();
  await visible(phone.getByRole('heading', { name: 'Side by side' }));
  await noOverflow();
  await phone.close();
  assert.deepEqual(errors, [], 'Browser console and HTTP errors');
  console.log('Verified the plan guide, benchmark switching, tunnel cutaway, on-demand results, resume, audit, and mobile controls. Zero console errors.');
} catch (error) {
  if (desktop && !desktop.isClosed()) await screenshot(desktop, 'failure').catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  throw error;
} finally {
  await browser.close();
}
