// Captures reviewer screenshots into test/shots/. Run after the build: node --test test/shots.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-api.mjs';
import { launch, newPage, signIn, open, tab, SHOTS } from './helpers.mjs';

let mock, browser;
test.before(async () => { mock = await startMock({ pollMs: 60000 }); browser = await launch(); });
test.after(async () => { await browser?.close(); await mock?.close(); });

async function shot(name, who, opts, prep) {
  await mock.ctl('reset');
  const page = await newPage(browser, mock, opts);
  try {
    if (who) await signIn(page, who); else await open(page);
    if (prep) await prep(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    assert.deepEqual(page.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  } finally { await page.context().close(); }
}
const pick = (page, st) => page.evaluate(async (n) => { const m = await import('/state.mjs'); m.setSel({ t: 'st', i: window.__blr.S.MD.stIdx.get(n) }); m.setTab('station'); }, st);

test('screenshots', async () => {
  await shot('signin-light', null, {});
  await shot('desktop-light', 'commissioner', {});
  await shot('desktop-dark', 'commissioner', { colorScheme: 'dark', theme: 'dark' });
  await shot('mobile-dark', 'commissioner', { viewport: { width: 390, height: 844 }, colorScheme: 'dark', theme: 'dark' });
  await shot('mobile-light-actions', 'north.dcp', { viewport: { width: 390, height: 844 } }, (p) => tab(p, 'actions'));
  await shot('kannada', 'commissioner', { lang: 'kn' });
  await shot('station-role', 'yalahanka', {}, (p) => tab(p, 'actions'));
  await shot('station-detail', 'commissioner', {}, (p) => pick(p, 'Yalahanka'));
  await shot('works-clash', 'commissioner', {}, async (p) => { await tab(p, 'works'); });
  await mock.ctl('reset');
  const page = await newPage(browser, mock, { colorScheme: 'dark', theme: 'dark' });
  try {
    await signIn(page, 'commissioner'); await tab(page, 'planner'); await page.getByTestId('pl-st').selectOption({ label: 'Yalahanka · North' }); await page.getByTestId('pl-run').click();
    await page.waitForSelector('[data-testid=matrix]', { timeout: 90000 }); await page.getByTestId('cell-closepeakPM').click(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/planner-dark.png` });
  } finally { await page.context().close(); }
  await shot('gate-denied', null, {}, async (p) => { await p.getByTestId('dev-email').fill('nobody@example.test'); await p.getByTestId('dev-email').press('Enter'); await p.waitForSelector('[data-testid=gate-denied]'); });
});
