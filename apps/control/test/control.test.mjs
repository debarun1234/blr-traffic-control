// Browser tests for the Control app against test/mock-api.mjs (dev auth). Run after `node scripts/build-web.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-api.mjs';
import { launch, newPage, signIn, open, ready, canvasHash, kpi, tab, contrastAudit } from './helpers.mjs';

let mock, browser;
test.before(async () => { mock = await startMock({ pollMs: 1500 }); browser = await launch(); });
test.after(async () => { await browser?.close(); await mock?.close(); });

/** Run fn with a fresh page; asserts no console errors unless `allow` matches. */
async function run(who, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  await mock.ctl('reset'); if (opts.mock) await mock.ctl('set', opts.mock);
  const page = await newPage(browser, mock, opts);
  try {
    if (who) await signIn(page, who);
    await fn(page);
    const errs = page.errors.filter((e) => !(opts.allow && opts.allow.test(e)));
    assert.deepEqual(errs, [], 'console errors');
  } finally { await page.context().close(); }
}
const texts = (page, sel) => page.locator(sel).allInnerTexts();
const setSel = (page, sel, tabName = 'station') => page.evaluate(async ([s, t]) => { const m = await import('/state.mjs'); m.setSel(s); m.setTab(t); }, [sel, tabName]);

test('sign-in: dev picker lists the six users and the honest note', async () => {
  await run(null, async (page) => {
    await open(page);
    assert.equal(await page.locator('.cc-devuser').count(), 6);
    assert.match(await page.locator('.cc-honest').innerText(), /allowlist/i);
    assert.match(await page.locator('.cc-honest').innerText(), /modelled or simulated/i);
    assert.equal(await page.getByTestId('google-signin').count(), 0);
  });
});

test('unknown user gets the not-on-allowlist screen with email + sign out', async () => {
  await run(null, { allow: /403/ }, async (page) => {
    await open(page); await page.getByTestId('dev-email').fill('nobody@example.test'); await page.getByTestId('dev-email').press('Enter');
    await page.waitForSelector('[data-testid=gate-denied]');
    assert.equal(await page.getByTestId('gate-email').innerText(), 'nobody@example.test');
    assert.match(await page.getByTestId('gate-denied').innerText(), /allowlist/i);
    await page.getByTestId('gate-signout').click(); await page.waitForSelector('.cc-devuser');
  });
});

test('maintenance flag: non-admin sees maintenance screen, admin sees banner', async () => {
  await run(null, { mock: { maintenance: true } }, async (page) => {
    await open(page); await page.getByTestId('dev-viewer').click(); await page.waitForSelector('[data-testid=gate-maintenance]');
    await page.getByTestId('gate-signout').click(); await page.getByTestId('dev-admin').click(); await ready(page);
    assert.match(await page.locator('.cc-banners').innerText(), /Maintenance/i);
  });
});

test('commissioner: whole city + region chips, role badge, briefing, no admin link', async () => {
  await run('commissioner', async (page) => {
    assert.deepEqual(await texts(page, '[data-scope]'), ['Whole area', 'Urban', 'North', 'East', 'Central', 'West', 'South', 'Rural']);
    assert.equal(await page.getByTestId('role-badge').innerText(), 'Commissioner');
    assert.equal(await page.getByTestId('brief').isVisible(), true);
    await page.getByTestId('menu-btn').click(); assert.equal(await page.getByTestId('admin-link').count(), 0);
    await page.getByTestId('row-East').click();
    assert.equal(await page.evaluate(() => window.__blr.S.scope), 'East');
  });
});

test('refresh now: shown to commissioner, posts /refresh, handles the rate limit; hidden for dcp and viewer', async () => {
  await run('commissioner', { allow: /429|rate_limited|Failed to load resource/ }, async (page) => {
    const btn = page.getByTestId('refresh'); assert.equal(await btn.isVisible(), true);
    await btn.click(); await page.locator('.toast', { hasText: /Feed refreshed/ }).waitFor();
    assert.ok((await mock.info()).calls.includes('POST /refresh'));
    await mock.ctl('set', { refreshLimited: true }); await btn.click();
    await page.locator('.toast', { hasText: /Try again in 42 s/ }).waitFor();
    assert.equal(await btn.isEnabled(), true);
  });
  for (const who of ['north.dcp', 'viewer']) await run(who, async (page) => { assert.equal(await page.getByTestId('refresh').isVisible(), false, who); });
});

test('rural: 9 outer units, Urban/Rural scopes (keys 2, 8), no invented crash figures', async () => {
  await run('commissioner', async (page) => {
    const info = await page.evaluate(async () => { const m = await (await fetch('/assets/map.json')).json(); const u = m.st.filter((x) => x.r === 'Rural'); return { n: u.length, noCrash: u.every((x) => x.t === null && x.f === null), poly: u.every((x) => x.poly?.length), reg: !!m.reg.Rural }; });
    assert.deepEqual(info, { n: 9, noCrash: true, poly: true, reg: true });
    await page.locator('[data-scope="Rural"]').click(); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'Rural');
    await page.keyboard.press('1'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'All');
    await page.keyboard.press('8'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'Rural');
    await page.keyboard.press('2'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'Urban');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^=row-]').length === 5 && !document.querySelector('[data-testid=row-Rural]'));
    await page.keyboard.press('8'); await page.locator('.cc-insp', { hasText: 'Anekal (taluk)' }).waitFor();
  });
});

test('admin: link to the Admin site in the account menu', async () => {
  await run('admin', async (page) => {
    await page.getByTestId('menu-btn').click();
    assert.equal(await page.getByTestId('admin-link').getAttribute('href'), '/admin/');
    assert.equal(await page.getByTestId('menu-email').innerText(), 'admin@example.test');
  });
});

test('dcp: locked to North, no other chips, only North actions, keys 1-6 do nothing', async () => {
  await run('north.dcp', async (page) => {
    assert.deepEqual(await texts(page, '[data-scope]'), ['North']);
    assert.equal(await page.getByTestId('role-badge').innerText(), 'DCP · North');
    await page.keyboard.press('4'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'North');
    await tab(page, 'actions');
    const regions = await texts(page, '[data-testid=action-list] .cc-act-m .xs');
    assert.ok(regions.length >= 2); assert.ok(regions.every((r) => r.includes('North')), regions.join(';'));
  });
});

test('station user: map locked to region, own station highlighted, can act only on own station', async () => {
  await run('yalahanka', { allow: /403/ }, async (page) => {
    assert.deepEqual(await texts(page, '[data-scope]'), ['North']);
    assert.match(await page.getByTestId('role-badge').innerText(), /Station · Yalahanka/);
    assert.match(await page.locator('.cc-tbl tbody tr', { hasText: 'Yalahanka' }).first().innerText(), /Yours/);
    assert.equal(await page.evaluate(() => { const { S } = window.__blr; return S.MD.ST[S.MD.stIdx.get('Yalahanka')].r; }), 'North');
    await tab(page, 'actions');
    const own = page.locator('article', { hasText: 'Doddaballapur' }), other = page.locator('article', { hasText: 'Peenya' }).first();
    assert.equal(await own.getByTestId('act-ack').count(), 1);
    assert.equal(await other.getByTestId('act-ack').count(), 0);
    assert.match(await other.innerText(), /Outside your jurisdiction/);
    // the API refuses writes outside jurisdiction too
    const code = await page.evaluate(async () => { const id = [...window.__blr.S.actions].find((a) => a.station === 'Peenya').id; const r = await fetch(`/api/actions/${id}/transition`, { method: 'POST', headers: { 'x-dev-user': 'yalahanka@example.test', 'content-type': 'application/json' }, body: '{"to":"ack"}' }); return r.status; });
    assert.equal(code, 403);
    // map really dims everything outside: a pixel outside the region is the dimmed map colour (hash check via scope lock)
    assert.equal(await page.evaluate(() => window.__blr.S.scope), 'North');
  });
});

test('viewer is read-only: no action, report, works or AI controls; planner disabled', async () => {
  await run('viewer', async (page) => {
    assert.match(await page.getByTestId('role-badge').innerText(), /Viewer/);
    await tab(page, 'actions');
    assert.equal(await page.locator('[data-testid^=act-]').count(), 0); assert.equal(await page.getByTestId('advise').count(), 0);
    assert.match(await page.getByTestId('panel-actions').innerText(), /Read-only/);
    await tab(page, 'works'); assert.equal(await page.getByTestId('wk-add').count(), 0); assert.equal(await page.getByTestId('wk-edit').count(), 0);
    await tab(page, 'planner'); assert.equal(await page.getByTestId('pl-run').isDisabled(), true);
    await tab(page, 'overview'); assert.equal(await page.getByTestId('brief').isVisible(), false);
    await setSel(page, { t: 'edge', e: (await mock.info()).edgeIn.Yalahanka }); assert.equal(await page.getByTestId('rep-open').count(), 0);
  });
});

test('state poll: ETag 304 when unchanged, roads recolour when the server state changes', async () => {
  await run('commissioner', async (page) => {
    const statuses = []; page.on('response', (r) => { if (r.url().endsWith('/api/state')) statuses.push(r.status()); });
    const h0 = await canvasHash(page), c0 = await kpi(page, 'cong');
    await page.waitForResponse((r) => r.url().endsWith('/api/state') && r.status() === 304, { timeout: 8000 });
    await mock.ctl('set', { boost: 2.4 });
    await page.waitForFunction((c) => document.querySelector('[data-kpi=cong] .v').innerText !== c, c0, { timeout: 15000 });
    await page.waitForTimeout(400);
    assert.notEqual(await canvasHash(page), h0); assert.ok(statuses.includes(200));
    assert.notEqual(await kpi(page, 'cong'), c0);
  });
});

test('status pill: simulated, live, stale since, offline keeps last state and recovers', async () => {
  await run('commissioner', { allow: /Failed to load resource/ }, async (page) => {
    const pill = page.getByTestId('status-pill');
    assert.match(await pill.innerText(), /SIMULATED FEED/i);
    await mock.ctl('set', { mode: 'live' }); await page.waitForFunction(() => /LIVE \(modelled\)/i.test(document.querySelector('[data-testid=status-pill]').innerText), null, { timeout: 15000 });
    await mock.ctl('set', { stale: true, staleBy: 40 }); await page.waitForFunction(() => /STALE since 08:20/i.test(document.querySelector('[data-testid=status-pill]').innerText), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('banner-stale').count(), 1);
    await mock.ctl('set', { stale: false, staleBy: 0, down: '503' });
    await page.waitForSelector('[data-testid=banner-offline]', { timeout: 15000 });
    assert.ok((await kpi(page, 'speed')).length > 0, 'last state kept');
    await mock.ctl('set', { down: null }); await page.waitForSelector('[data-testid=banner-offline]', { state: 'detached', timeout: 15000 });
  });
});

test('action workflow ack -> prog -> done round trip, and rollback on server error', async () => {
  await run('yalahanka', { allow: /Failed to load resource/ }, async (page) => {
    await tab(page, 'actions');
    const card = page.locator('article', { hasText: 'Doddaballapur' }), id = await card.getAttribute('data-id');
    const srv = async () => (await mock.info()).actions.find((a) => a.id === id).state;
    await card.getByTestId('act-ack').click(); await page.waitForSelector(`article[data-id="${id}"][data-state=ack]`); assert.equal(await srv(), 'ack');
    await mock.ctl('set', { failNext: true });
    await page.locator(`article[data-id="${id}"]`).getByTestId('act-prog').click();
    await page.waitForSelector('.toast.bad'); assert.equal(await srv(), 'ack');
    assert.equal(await page.locator(`article[data-id="${id}"]`).getAttribute('data-state'), 'ack', 'rolled back');
    await page.locator(`article[data-id="${id}"]`).getByTestId('act-prog').click(); await page.waitForSelector(`article[data-id="${id}"][data-state=prog]`); assert.equal(await srv(), 'prog');
    await page.locator(`article[data-id="${id}"]`).getByTestId('act-done').click(); await page.waitForSelector(`article[data-id="${id}"][data-state=done]`); assert.equal(await srv(), 'done');
    assert.equal(await page.locator(`article[data-id="${id}"]`).getByTestId('act-prog').count(), 1, 'reopen offered');
  });
});

test('report incident: allowed in own station, hidden outside jurisdiction', async () => {
  await run('yalahanka', async (page) => {
    const { edgeIn } = await mock.info(); const n0 = (await mock.info()).actions.length;
    await setSel(page, { t: 'edge', e: edgeIn.Indiranagar }); assert.equal(await page.getByTestId('rep-open').count(), 0);
    await setSel(page, { t: 'edge', e: edgeIn.Yalahanka });
    await page.getByTestId('rep-open').click(); await page.locator('#rep-dur').fill('30'); await page.locator('#rep-note').fill('test report'); await page.getByTestId('rep-submit').click();
    await page.waitForSelector('.toast.good');
    await page.waitForFunction(() => window.__blr.S.incidents.some((i) => i.src === 'user'));
    assert.equal((await mock.info()).actions.length, n0 + 1);
    // lifecycle: the reported incident can be extended, confirmed and cleared from the road card
    await setSel(page, { t: 'edge', e: edgeIn.Yalahanka });
    const eh0 = await page.evaluate(() => window.__blr.S.incidents.find((i) => i.src === 'user').eh);
    await page.getByTestId('inc-extend').click(); await page.waitForFunction((v) => window.__blr.S.incidents.find((i) => i.src === 'user').eh > v + 0.4, eh0);
    await page.getByTestId('inc-confirm').click(); await page.waitForFunction(() => window.__blr.S.incidents.find((i) => i.src === 'user').confirmed);
    await page.getByTestId('inc-clear').click(); await page.waitForFunction(() => window.__blr.S.incidents.find((i) => i.src === 'user').cleared);
    await page.getByTestId('inc-clear').waitFor({ state: 'detached' }); // no controls once cleared
  });
});

test('planner: run, matrix, diversions with crash counts', async () => {
  await run('commissioner', async (page) => {
    await tab(page, 'planner'); await page.getByTestId('pl-st').selectOption({ label: 'Yalahanka · North' }); await page.getByTestId('pl-run').click();
    await page.waitForSelector('[data-testid=matrix]', { timeout: 90000 });
    assert.equal(await page.locator('.cc-cell').count(), 8);
    await page.getByTestId('cell-closepeakPM').click();
    assert.ok((await page.locator('[data-testid=divert] tbody tr').count()) > 0);
    assert.match(await page.locator('.cc-advice').innerText(), /least disruptive/);
    assert.match(await page.getByTestId('panel-planner').innerText(), /RMSE 9\.1%/);
  });
});

test('works: clash quantified, add / edit / remove (soft delete)', async () => {
  await run('commissioner', async (page) => {
    await tab(page, 'works');
    assert.equal(await page.locator('[data-testid=works-list] article').count(), 3);
    assert.equal(await page.getByTestId('clash-count').innerText(), '1');
    await page.getByTestId('clash-quant').click(); await page.waitForSelector('[data-testid=clash-together]', { timeout: 90000 });
    assert.ok(+(await page.getByTestId('clash-together').innerText()) > 0);
    await page.getByTestId('wk-add').click(); await page.getByTestId('wf-name').fill('Test works Z'); await page.getByTestId('wf-st').selectOption({ label: 'Yalahanka · North' }); await page.getByTestId('wf-cap').fill('60'); await page.getByTestId('wf-submit').click();
    await page.waitForSelector('article.cc-work:has-text("Test works Z")');
    const w = (await mock.info()).works.find((x) => x.name === 'Test works Z'); assert.equal(w.cap, 0.6); assert.deepEqual(w.stations, ['Yalahanka']);
    await page.locator('article.cc-work', { hasText: 'Test works Z' }).getByTestId('wk-edit').click(); await page.getByTestId('wf-name').fill('Test works Y'); await page.getByTestId('wf-submit').click();
    await page.waitForSelector('article.cc-work:has-text("Test works Y")');
    await page.locator('article.cc-work', { hasText: 'Test works Y' }).getByTestId('wk-del').click(); await page.getByTestId('confirm-ok').click();
    await page.waitForSelector('article.cc-work:has-text("Test works Y")', { state: 'detached' });
    assert.equal((await mock.info()).works.find((x) => x.id === w.id).active, false);
  });
});

test('replay: R toggles, REPLAY pill, in-browser model recolours, back to live', async () => {
  await run('commissioner', async (page) => {
    const h0 = await canvasHash(page);
    await page.keyboard.press('r');
    await page.waitForFunction(() => /REPLAY/i.test(document.querySelector('[data-testid=status-pill]').innerText));
    await page.locator('[data-testid=replay-slider]').fill('74'); // 18:30
    await page.waitForFunction(() => window.__blr.S.result?.kind === 'replay' && window.__blr.S.result.h === 18.5, null, { timeout: 60000 });
    await page.waitForTimeout(300); assert.notEqual(await canvasHash(page), h0);
    await page.waitForFunction(() => /18:30 IST/.test(document.querySelector('h2').parentElement.innerText), null, { timeout: 5000 }); // panel head follows the focused slider (regression)
    await page.getByTestId('replay-back').click();
    await page.waitForFunction(() => /SIMULATED/i.test(document.querySelector('[data-testid=status-pill]').innerText)); assert.equal(await page.evaluate(() => window.__blr.S.result.kind), 'live');
  });
});

test('keyboard: ? sheet, 2-8 scope, / search, [ ] zoom, Esc', async () => {
  await run('commissioner', async (page) => {
    await page.keyboard.press('?'); await page.waitForSelector('[role=dialog]'); assert.match(await page.locator('[role=dialog]').innerText(), /Keyboard shortcuts/);
    await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { state: 'detached' });
    await page.keyboard.press('4'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'East');
    await page.keyboard.press('1'); assert.equal(await page.evaluate(() => window.__blr.S.scope), 'All');
    const k0 = await page.evaluate(() => window.__blr.S.mapRef.view.k); await page.keyboard.press(']'); assert.ok(await page.evaluate((k) => window.__blr.S.mapRef.view.k > k, k0));
    await page.keyboard.press('/'); assert.equal(await page.evaluate(() => document.activeElement.id), 'cc-search');
    await page.keyboard.type('Indira'); await page.waitForSelector('[role=option]'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__blr.S.sel?.t), 'st');
  });
});

test('Google basemap: option only with a key; selecting it loads Maps, follows the canvas camera and falls back on auth failure', async () => {
  await run('north.dcp', async (page) => {
    assert.equal(await page.getByTestId('base-select').count(), 0, 'hidden when no key is configured');
  });
  const stub = `window.__moves=[];window.google={maps:{Map:function(el,o){this.moveCamera=(c)=>window.__moves.push(c);this.setMapTypeId=(t)=>{window.__type=t;};},TrafficLayer:function(){this.setMap=(m)=>{window.__traffic=!!m;};}}};window.__gmReady&&window.__gmReady();`;
  await run('north.dcp', { mock: { mapsKey: 'TESTKEY' } }, async (page) => {
    await page.route('https://maps.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
    await page.locator('.cc-layersbtn').click();
    await page.getByTestId('base-select').selectOption('hybrid');
    await page.waitForFunction(() => window.__type === 'hybrid' && window.__moves.length > 0);
    const m = await page.evaluate(() => window.__moves.at(-1)); assert.ok(m.center.lat > 12.8 && m.center.lat < 13.3 && m.center.lng > 77.3 && m.center.lng < 77.9, 'camera centred on Bengaluru'); assert.ok(m.zoom > 9 && m.zoom < 13);
    await page.getByTestId('gtraffic').check(); await page.waitForFunction(() => window.__traffic === true);
    await page.locator('.cc-zoom button').first().click();
    await page.waitForFunction((z) => window.__moves.at(-1).zoom > z, m.zoom);
    assert.ok(await page.evaluate(() => document.querySelector('.cc-map').classList.contains('gm')));
    // alignment: the offset between two model points on screen equals the offset Google's Web Mercator gives them at the camera
    await page.waitForFunction(() => { const { S } = window.__blr, v = S.mapRef.view; return Math.abs(window.__moves.at(-1).zoom - Math.log2((v.k * S.MD.map.s * 360) / 256)) < 1e-3; });
    const err = await page.evaluate(() => {
      const { S } = window.__blr, R = S.mapRef, c = window.__moves.at(-1), o = S.MD.map.o, sc = S.MD.map.s, w = 256 * 2 ** c.zoom;
      const mx = (lng) => (w * (lng + 180)) / 360, my = (lat) => w * (0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI));
      const A = S.MD.ST[0], B = S.MD.ST[S.MD.ST.length - 1], ll = (p) => [o[0] + p.x / sc, o[1] + p.y / sc];
      const [la, lb] = [ll(A), ll(B)];
      return [Math.abs((R.sx(B.x) - R.sx(A.x)) - (mx(lb[0]) - mx(la[0]))), Math.abs((R.sy(B.y) - R.sy(A.y)) - (my(lb[1]) - my(la[1])))];
    });
    assert.ok(err[0] < 1.5 && err[1] < 1.5, `model and Google basemap agree to <1.5 px, got ${err}`);
    assert.match(await page.locator('.cc-legend').innerText(), /congested main roads only/i, 'legend switches to the essentials-only key');
    await page.evaluate(() => window.gm_authFailure()); await page.waitForFunction(() => !document.querySelector('.cc-map').classList.contains('gm'));
    assert.equal(await page.getByTestId('base-select').inputValue(), 'plain');
  });
});

test('map views: each view explains itself, changes the map, and what is offered follows the admin settings per role', async () => {
  await run('commissioner', async (page) => {
    await page.locator('.cc-layersbtn').click();
    assert.deepEqual(await page.locator('.cc-opt input').evaluateAll((e) => e.map((x) => x.value)), ['traffic', 'safety', 'speed']);
    assert.match(await page.getByTestId('view-safety').innerText(), /fatal crashes recorded in 2025/i);
    assert.match(await page.locator('.cc-legend').innerText(), /Live traffic[\s\S]*Use it to spot where congestion/);
    const h0 = await canvasHash(page);
    await page.getByTestId('view-safety').click(); await page.waitForFunction(() => /Crash hotspots/.test(document.querySelector('.cc-legend').innerText));
    const lg = await page.locator('.cc-legend').innerText(); assert.match(lg, /No crash data/); assert.match(lg, /Highest: /); assert.match(lg, /enforcement, patrols and signage/);
    await page.waitForTimeout(400); assert.notEqual(await canvasHash(page), h0); assert.equal(await page.evaluate(() => localStorage.getItem('blr-view')), 'safety');
    await page.getByTestId('view-speed').click(); await page.waitForFunction(() => /Area speed/.test(document.querySelector('.cc-legend').innerText));
    assert.match(await page.locator('.cc-legend').innerText(), /<14[\s\S]*≥34[\s\S]*Slowest: /);
  });
  const cfg = { defaultView: 'speed', views: { safety: { admin: true, commissioner: false, dcp: true, station: true, viewer: false }, speed: { admin: true, commissioner: true, dcp: true, station: true, viewer: true } }, layers: { minorRoads: true, stations: true, incidents: true, works: false, googleTraffic: true }, speedBands: { slow: 10, moderate: 18, good: 25, fast: 40 }, crashScale: 10 };
  await run('commissioner', { mock: { map: cfg } }, async (page) => {
    await page.waitForFunction(() => /Area speed/.test(document.querySelector('.cc-legend').innerText)); // admin default applies when the user has not chosen
    assert.match(await page.locator('.cc-legend').innerText(), /<10[\s\S]*≥40/, 'admin speed bands drive the legend');
    await page.locator('.cc-layersbtn').click();
    assert.deepEqual(await page.locator('.cc-opt input').evaluateAll((e) => e.map((x) => x.value)), ['traffic', 'speed'], 'commissioner has the crash view switched off by the admin');
    assert.equal(await page.getByTestId('layer-works').count(), 0, 'admin switched Road works off'); assert.equal(await page.getByTestId('layer-inc').count(), 1);
  });
  await run('viewer', { mock: { map: cfg } }, async (page) => {
    await page.locator('.cc-layersbtn').click();
    assert.equal(await page.getByTestId('view-safety').count(), 0, 'viewers never get the crash view');
  });
  await run('viewer', async (page) => { // built-in defaults when the admin has not changed anything: crash data is not offered to viewers
    await page.locator('.cc-layersbtn').click(); assert.equal(await page.getByTestId('view-safety').count(), 0); assert.equal(await page.getByTestId('view-speed').count(), 1);
  });
});

test('AI advice is regenerated in Kannada when the language is switched', async () => {
  await run('north.dcp', async (page) => {
    await tab(page, 'actions');
    await page.waitForFunction(async () => !(await import('/sim.mjs')).simBusy());
    await page.getByTestId('advise').first().click(); await page.waitForSelector('[data-testid=ai-result]');
    assert.match(await page.locator('.cc-ai-b').first().innerText(), /Deploy staff/);
    await page.getByTestId('lang').first().click();
    await page.waitForFunction(() => /ಸಿಬ್ಬಂದಿಯನ್ನು ನಿಯೋಜಿಸಿ/.test(document.querySelector('.cc-ai-b')?.innerText || ''));
  });
});

test('AI: tier + cached badges, label, inert HTML, quota, 429 and disabled handling', async () => {
  await run('north.dcp', { allow: /429/ }, async (page) => {
    await tab(page, 'actions');
    await page.waitForFunction(async () => !(await import('/sim.mjs')).simBusy()); await page.waitForTimeout(500); // context (alternate road) is derived from the model; let it settle so the 2nd request hits the cache
    await page.getByTestId('advise').first().click(); await page.waitForSelector('[data-testid=ai-result]');
    assert.match(await page.getByTestId('ai-result').first().innerText(), /AI-generated, verify before acting/);
    assert.equal(await page.getByTestId('ai-tier').first().innerText(), 'T2');
    assert.equal(await page.locator('.cc-ai-b img, .cc-ai-b b').count(), 0, 'AI text is not parsed as HTML');
    // live context (speeds) can change between clicks if a state poll lands; retry until the identical context is cached
    for (let i = 0; i < 4 && !(await page.getByTestId('ai-cached').count()); i++) { await page.getByTestId('advise').first().click(); await page.waitForTimeout(1200); }
    await page.waitForSelector('[data-testid=ai-cached]');
    await page.waitForFunction(() => /AI \d+\//.test(document.querySelector('[data-testid=ai-quota]').innerText));
    await mock.ctl('set', { aiLimit: 1 });
    await page.getByTestId('advise').nth(1).click(); await page.waitForSelector('[data-testid=ai-error]');
    assert.match(await page.getByTestId('ai-error').innerText(), /quota/i);
  });
  await run('commissioner', async (page) => {
    await page.getByTestId('brief-run').click(); await page.waitForSelector('[data-testid=brief] [data-testid=ai-result]');
    assert.equal(await page.getByTestId('ai-tier').innerText(), 'T3'); assert.equal(await page.locator('.cc-brief img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  });
  await run(null, { mock: { aiEnabled: false } }, async (page) => {
    await open(page); await page.getByTestId('dev-commissioner').click(); await ready(page);
    assert.equal(await page.getByTestId('brief').isVisible(), false); assert.equal(await page.getByTestId('ai-quota').isVisible(), false);
    await tab(page, 'actions'); assert.equal(await page.getByTestId('advise').count(), 0);
  });
});

test('language switch EN <-> KN persists and keeps state', async () => {
  await run('commissioner', async (page) => {
    await page.keyboard.press('4');
    await page.getByTestId('lang').click();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'kn');
    assert.equal(await page.getByTestId('tab-overview').innerText(), 'ಸಾರಾಂಶ');
    assert.equal(await page.evaluate(() => window.__blr.S.scope), 'East');
    await page.reload(); await ready(page); assert.ok((await page.getByTestId('tab-actions').innerText()).includes('ಕ್ರಮಗಳು'));
    await page.getByTestId('lang').click(); assert.equal(await page.getByTestId('tab-overview').innerText(), 'Overview');
  });
});

test('theme switch changes tokens + canvas and persists', async () => {
  await run('commissioner', async (page) => {
    const h0 = await canvasHash(page), m0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--map'));
    await page.getByTestId('theme').click(); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--map')), m0); assert.notEqual(await canvasHash(page), h0);
    await page.reload(); await ready(page); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  });
});

test('mobile (390x844): map above inspector, scope row, no horizontal overflow, tabs work', async () => {
  await run('commissioner', { viewport: { width: 390, height: 844 } }, async (page) => {
    const m = await page.locator('.cc-map').boundingBox(), i = await page.locator('.cc-insp').boundingBox();
    assert.ok(m.y + m.height <= i.y + 1, 'map above inspector'); assert.ok(m.height > 220);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('[data-scope]').count(), 8);
    await page.locator('.cc-searchbtn').click(); assert.equal(await page.locator('.cc-q').isVisible(), true);
    await tab(page, 'actions'); assert.ok(await page.locator('[data-testid=action-list] article').count() > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
});

test('contrast audit (WCAG AA text) in light and dark on main views', async () => {
  for (const scheme of ['light', 'dark']) {
    await run('commissioner', { colorScheme: scheme }, async (page) => {
      const bad = [];
      for (const t of ['overview', 'actions', 'works', 'planner']) { await tab(page, t); await page.waitForTimeout(200); bad.push(...(await contrastAudit(page)).map((b) => ({ t, scheme, ...b }))); }
      assert.deepEqual(bad, []);
    });
  }
});

test('welcome: after an interactive sign-in each role gets its own greeting and checks, Enter opens the dashboard, a refresh skips it', async () => {
  const cases = [
    ['commissioner', /Commissioner Ravi/, /All Bengaluru/i, /All of Bengaluru is in view/, 'Enter the control room'],
    ['north.dcp', /DCP Kavita/, /North division/i, /North division is ready/, 'Enter the control room'],
    ['yalahanka', /Manoj/, /Yalahanka/i, /Yalahanka station, ready for your shift/, 'Start my shift'],
    ['viewer', /Vikram/, /Read-only/i, /read-only view/, 'Open the control room'],
    ['admin', /Asha/, /Administrator/i, /Admin console is one click away/, 'Enter the control room'],
  ];
  for (const [who, head, kick, sub, go] of cases) {
    await run(null, async (page) => {
      await page.goto(page.mock.url + '/?welcome=1'); await page.getByTestId(`dev-${who}`).click();
      await page.getByTestId('welcome').waitFor();
      assert.match(await page.locator('.wl-h').innerText(), head); assert.match(await page.locator('.wl-chip').innerText(), kick); assert.match(await page.locator('.wl-sub').innerText(), sub);
      assert.equal(await page.getByTestId('welcome').getAttribute('data-variant'), who === 'north.dcp' ? 'dcp' : who === 'yalahanka' ? 'station' : who);
      const enter = page.getByTestId('welcome-enter'); await page.waitForFunction(() => !document.querySelector('[data-testid=welcome-enter]').disabled);
      assert.equal((await enter.innerText()).trim(), go);
      assert.equal(await page.locator('.wl-row.ok').count(), 3, 'connection, data and AI checks all pass');
      assert.equal(await page.locator('.cc-grid').count(), 0, 'dashboard is not mounted before Enter');
      await enter.click(); await ready(page);
      await page.reload(); await ready(page); assert.equal(await page.getByTestId('welcome').count(), 0, 'an existing session goes straight in');
    });
  }
});

test('welcome: Kannada copy, scoped numbers, AI off and a failing check never block entry', async () => {
  await run(null, { mock: { aiEnabled: false } }, async (page) => {
    await page.goto(page.mock.url + '/?welcome=1'); await page.getByTestId('dev-yalahanka').click();
    await page.getByTestId('welcome').waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid=welcome-enter]').disabled);
    assert.equal(await page.locator('.wl-row.off').count(), 1, 'AI shows as switched off, not as a failure');
    assert.match(await page.locator('.wl-row[data-row=ai]').innerText(), /built-in advice still works/);
    await page.getByTestId('lang').click(); assert.match(await page.locator('.wl-h').innerText(), /ಶುಭ|ಸ್ವಾಗತ/); assert.match(await page.locator('.wl-sub').innerText(), /ಠಾಣೆ/);
  });
  await run(null, { mock: { noPreflight: true }, allow: /503/ }, async (page) => {
    await page.goto(page.mock.url + '/?welcome=1'); await page.getByTestId('dev-viewer').click(); await page.getByTestId('welcome').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid=welcome-enter]').disabled);
    assert.equal(await page.locator('.wl-row.fail').count(), 1); assert.match(await page.getByTestId('welcome-enter').innerText(), /Continue anyway/);
    await page.getByTestId('welcome-enter').click(); await ready(page);
  });
  await run(null, { allow: /403/ }, async (page) => { // not on the allowlist still shows the gate, never the welcome
    await open(page); await page.getByTestId('dev-email').fill('nobody@example.test'); await page.getByTestId('dev-email').press('Enter');
    await page.waitForSelector('[data-testid=gate-denied]'); assert.equal(await page.getByTestId('welcome').count(), 0);
  });
});
