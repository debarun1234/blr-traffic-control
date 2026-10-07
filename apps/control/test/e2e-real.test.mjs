// End-to-end against the REAL dev API (apps/api/src/dev.mjs). Skipped unless REAL_URL is set:
//   PORT=8790 node apps/api/src/dev.mjs &   REAL_URL=http://127.0.0.1:8790 node --test test/e2e-real.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, chromium } from './helpers.mjs';

const URL_ = process.env.REAL_URL;
const skip = !URL_;
let browser;
const mk = async (who, vp = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('blr-lang', 'en'); } catch {} });
  const page = await ctx.newPage(); page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(URL_ + '/'); await page.getByTestId(`dev-${who}`).click();
  await page.waitForSelector('[data-kpi=speed] .v span', { timeout: 30000 });
  return page;
};
test.before(async () => { if (!skip) browser = await launch(); });
test.after(async () => { await browser?.close(); });

for (const who of ['admin', 'commissioner', 'north.dcp', 'yalahanka', 'indiranagar', 'viewer']) {
  test(`real API: ${who} loads, role scoping and no console errors`, { skip, timeout: 90000 }, async () => {
    const page = await mk(who);
    const chips = await page.locator('[data-scope]').allInnerTexts();
    const role = await page.getByTestId('role-badge').innerText();
    if (who === 'north.dcp' || who === 'yalahanka') assert.deepEqual(chips, ['North']);
    else if (who === 'indiranagar') assert.deepEqual(chips, ['East']);
    else assert.equal(chips.length, 6);
    console.log(who, '->', role, '| chips', chips.join(','), '| pill', await page.getByTestId('status-pill').innerText());
    await page.getByTestId('tab-actions').click();
    const n = await page.locator('[data-testid=action-list] article').count();
    const btns = await page.locator('[data-testid^=act-]').count();
    console.log(who, 'actions', n, 'action buttons', btns);
    if (who === 'viewer') assert.equal(btns, 0);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}
test('real API: transition, report incident, works CRUD, AI, planner', { skip, timeout: 180000 }, async () => {
  const page = await mk('commissioner');
  await page.getByTestId('tab-actions').click();
  const first = page.locator('[data-testid=action-list] article[data-state=new]').first();
  const id = await first.getAttribute('data-id');
  await first.getByTestId('act-ack').click();
  await page.waitForSelector(`article[data-id="${id}"][data-state=ack]`, { timeout: 10000 });
  await page.locator(`article[data-id="${id}"]`).getByTestId('act-prog').click();
  await page.waitForSelector(`article[data-id="${id}"][data-state=prog]`, { timeout: 10000 });
  await page.locator(`article[data-id="${id}"]`).getByTestId('act-done').click();
  await page.waitForSelector(`article[data-id="${id}"][data-state=done]`, { timeout: 10000 });
  // advise
  await page.locator('[data-testid=advise]').first().click();
  await page.waitForSelector('[data-testid=ai-result],[data-testid=ai-error]', { timeout: 20000 });
  console.log('advise ->', (await page.locator('[data-testid=ai-result],[data-testid=ai-error]').first().innerText()).slice(0, 160).replace(/\n/g, ' | '));
  // report incident on a selected edge
  const e = await page.evaluate(async () => { const { S } = window.__blr; for (let e = 0; e < S.MD.net.ne; e++) if (S.MD.net.name[e] >= 0 && S.MD.net.cls[e] <= 1) return e; });
  await page.evaluate(async (e) => { const m = await import('/state.mjs'); m.setSel({ t: 'edge', e }); m.setTab('station'); }, e);
  await page.getByTestId('rep-open').click(); await page.getByTestId('rep-submit').click();
  await page.waitForSelector('.toast.good', { timeout: 10000 });
  // works
  await page.getByTestId('tab-works').click();
  const before = await page.locator('[data-testid=works-list] article').count();
  await page.getByTestId('wk-add').click();
  await page.getByTestId('wf-name').fill('E2E test works'); await page.getByTestId('wf-submit').click();
  await page.waitForFunction((b) => document.querySelectorAll('[data-testid=works-list] article').length === b + 1, before, { timeout: 10000 });
  await page.locator('article.cc-work', { hasText: 'E2E test works' }).getByTestId('wk-del').click(); await page.getByTestId('confirm-ok').click();
  await page.waitForFunction((b) => document.querySelectorAll('[data-testid=works-list] article').length === b, before, { timeout: 10000 });
  // planner
  await page.getByTestId('tab-planner').click(); await page.getByTestId('pl-run').click();
  await page.waitForSelector('[data-testid=matrix]', { timeout: 90000 });
  console.log('briefing:'); await page.getByTestId('tab-overview').click();
  const b = page.getByTestId('brief-run'); if (await b.count()) { await b.click(); await page.waitForSelector('[data-testid=ai-result],[data-testid=ai-error]', { timeout: 20000 }); console.log((await page.locator('.cc-brief').innerText()).slice(0, 200).replace(/\n/g, ' | ')); }
  assert.deepEqual(page.errors, []);
});
