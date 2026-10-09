import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { startMock } from './mock-api.mjs';
import { loadPlaywright } from './pw.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, 'shots'); mkdirSync(SHOTS, { recursive: true });
const MAP = JSON.parse(readFileSync(join(here, '../../../packages/mapdata/map.json'), 'utf8'));
let mock, browser, ctx, page, problems;

before(async () => {
  mock = await startMock({ env: 'staging' });
  const pw = await loadPlaywright(); browser = await pw.chromium.launch();
});
after(async () => { await browser?.close(); await mock?.close(); });
beforeEach(async () => {
  await fetch(mock.url + '/__test/reset'); await fetch(mock.url + '/__test/env?v=staging');
  ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page = await ctx.newPage(); problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
});
afterEach(async (t) => { const p = problems.filter((x) => !(t.name.includes('allowlist') && /403|Failed to load resource/.test(x)) && !/status of (409|400|403|404)|Failed to load resource: the server responded/.test(x)); await ctx.close(); assert.deepEqual(p, [], 'console errors/warnings'); });

const login = async (email = 'admin@blr.test') => { await page.goto(mock.url + '/'); await page.fill('#dev-email', email); await page.click('button[type=submit]'); };
const open = async (id, email) => { await login(email); await page.waitForSelector('.shell'); await page.goto(`${mock.url}/#/${id}`); await page.waitForSelector(`.page[data-page=${id}] h1`); await page.waitForFunction(() => !document.querySelector('.sk-wrap')); };
const toast = (txt) => page.locator('.toast', { hasText: txt }).first().waitFor();
const dlg = () => page.getByRole('dialog');
const serverState = async () => (await fetch(mock.url + '/__test/state')).json();
const shot = (name) => page.screenshot({ path: join(SHOTS, name + '.png') });
const api = async (method, path, body, user = 'admin@blr.test') => { const r = await fetch(mock.url + '/api' + path, { method, headers: { 'x-dev-user': user, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

test('non-admin is refused with a link back to Control; non-allowlisted gets allowlist message', async () => {
  await login('station.indira@blr.test');
  await page.getByRole('heading', { name: 'Administrators only' }).waitFor();
  assert.equal(await page.locator('.shell').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Go to the Control app' }).getAttribute('href'), 'https://control.example.test/');
  assert.match(await page.locator('.denied').innerText(), /station/);
  await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForSelector('#dev-email');
  await login('nobody@blr.test'); await page.getByRole('heading', { name: 'You are not on the allowlist' }).waitFor();
});

test('environment ribbon is always visible and reflects config.env', async () => {
  await open('overview');
  assert.match(await page.locator('#ribbon').innerText(), /staging/i);
  await fetch(mock.url + '/__test/env?v=production'); await page.reload(); await page.waitForSelector('.shell');
  assert.equal(await page.locator('#ribbon').getAttribute('class'), 'production'); assert.match(await page.locator('#ribbon').innerText(), /live operations/);
  assert.equal(await page.locator('.topbar .env').innerText(), 'production');
});

test('session indicator and sign-out', async () => {
  await open('overview');
  assert.match(await page.locator('.sess').innerText(), /Asha Admin/); assert.match(await page.locator('.sess').innerText(), /admin@blr\.test/);
  await page.click('#signout'); await page.waitForSelector('#dev-email');
});

test('users: add, edit, deactivate, reactivate; self safeguards and last-admin error are surfaced', async () => {
  await open('users');
  await page.getByRole('button', { name: '+ Add user' }).click();
  // validation first
  await dlg().getByRole('button', { name: 'Add user' }).click();
  await dlg().locator('.errsum').waitFor(); assert.match(await dlg().locator('.errsum').innerText(), /Email/);
  await dlg().getByLabel('Email').fill('New.Officer@blr.test');
  await dlg().getByLabel('Role', { exact: false }).first().selectOption('station');
  await dlg().getByRole('button', { name: 'Add user' }).click();
  assert.match(await dlg().locator('.errsum').innerText(), /Station/);
  await dlg().getByLabel('Station', { exact: false }).selectOption('Whitefield');
  await dlg().getByRole('button', { name: 'Add user' }).click(); await toast('Added new.officer@blr.test');
  const row = page.locator('tr[data-email="new.officer@blr.test"]'); await row.waitFor();
  assert.match(await row.innerText(), /station/); assert.match(await row.innerText(), /Whitefield/);
  // duplicate -> 409 surfaced inside the dialog
  await page.getByRole('button', { name: '+ Add user' }).click(); await dlg().getByLabel('Email').fill('viewer@blr.test'); await dlg().getByRole('button', { name: 'Add user' }).click();
  await dlg().locator('.errsum', { hasText: 'already exists' }).waitFor(); await dlg().getByRole('button', { name: 'Cancel' }).click();
  // edit role to dcp
  await row.getByRole('button', { name: 'Edit new.officer@blr.test' }).click();
  assert.equal(await dlg().getByLabel('Email').isDisabled(), true);
  await dlg().getByLabel('Role').first().selectOption('dcp'); await dlg().getByLabel('Region', { exact: false }).selectOption('North');
  await dlg().getByRole('button', { name: 'Save changes' }).click(); await toast('Saved new.officer@blr.test');
  await page.waitForFunction(() => document.querySelector('tr[data-email="new.officer@blr.test"]')?.innerText.includes('North'));
  // deactivate
  await row.getByRole('button', { name: 'Deactivate new.officer@blr.test' }).click(); await dlg().getByRole('button', { name: 'Deactivate' }).click(); await toast('Deactivated new.officer@blr.test');
  await page.waitForFunction(() => !document.querySelector('tr[data-email="new.officer@blr.test"]'));
  await page.getByLabel('Status').selectOption('inactive'); const row2 = page.locator('tr[data-email="new.officer@blr.test"]'); await row2.waitFor();
  await row2.getByRole('button', { name: 'Reactivate new.officer@blr.test' }).click(); await toast('Reactivated');
  // self-demote is rejected by the server and shown inline
  await page.getByLabel('Status').selectOption('active');
  await page.locator('tr[data-email="admin@blr.test"]').getByRole('button', { name: 'Edit' }).click();
  assert.match(await dlg().innerText(), /own account/);
  await dlg().getByLabel('Role').first().selectOption('viewer'); await dlg().getByRole('button', { name: 'Save changes' }).click();
  await dlg().locator('.errsum', { hasText: 'cannot demote yourself' }).waitFor(); await dlg().getByRole('button', { name: 'Cancel' }).click();
  // self-deactivate
  await page.locator('tr[data-email="admin@blr.test"]').getByRole('button', { name: 'Deactivate admin@blr.test' }).click(); await dlg().getByRole('button', { name: 'Deactivate' }).click();
  await toast('cannot deactivate yourself');
  assert.equal((await serverState()).users.find((u) => u.email === 'admin@blr.test').active, true);
  // last-admin error text from server is displayed (simulated response, since a UI actor is always an admin)
  await page.route('**/api/admin/users/ops%40blr.test', (r) => r.request().method() === 'DELETE' ? r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'conflict', message: 'The last active admin cannot be removed.' } }) }) : r.continue());
  await page.locator('tr[data-email="ops@blr.test"]').getByRole('button', { name: 'Deactivate ops@blr.test' }).click(); await dlg().getByRole('button', { name: 'Deactivate' }).click(); await toast('last active admin');
});

test('users: filters and search; role matrix is shown', async () => {
  await open('users');
  await page.getByLabel('Search').fill('indira'); await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-email]').length === 1);
  await page.getByLabel('Search').fill(''); await page.locator('#u-role').selectOption('admin'); await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-email]').length === 2);
  await page.locator('#u-role').selectOption(''); await page.getByLabel('Status').selectOption('');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr[data-email]').length === 7);
  assert.ok(await page.getByRole('table', { name: 'Permissions by role' }).count());
});

test('modal focus management: focus moves in, is trapped, Escape closes and restores focus', async () => {
  await open('users');
  const btn = page.getByRole('button', { name: '+ Add user' }); await btn.focus(); await btn.click();
  await dlg().waitFor(); assert.ok(await page.evaluate(() => document.activeElement.closest('[role=dialog]') !== null));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement.closest('[role=dialog]') !== null), 'focus stays trapped');
  assert.equal(await page.locator('#app').getAttribute('inert'), '');
  await page.keyboard.press('Escape'); await dlg().waitFor({ state: 'detached' });
  assert.ok(await btn.evaluate((b) => b === document.activeElement), 'focus restored to trigger');
});

test('connectors: create REST connector, test, run, disable; validation and secret safety', async () => {
  await open('connectors');
  await page.click('#add-connector');
  await dlg().getByLabel('Name', { exact: false }).first().fill('ANPR speed poll');
  await dlg().getByLabel('Endpoint URL').fill('http://insecure.example/api');
  await dlg().getByLabel('Secret name', { exact: false }).fill(''+'AIza'+'FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12'+'');
  await dlg().locator('#connector-save').click();
  const sum = dlg().locator('.errsum'); await sum.waitFor();
  const txt = await sum.innerText(); assert.match(txt, /https/); assert.match(txt, /looks like a key value|key value/); assert.match(txt, /Map required fields/);
  // fix
  await dlg().getByLabel('Data kind').selectOption('speeds');
  await dlg().getByLabel('Endpoint URL').fill('https://anpr.example.gov.in/v1/speeds');
  await dlg().getByLabel('Secret name', { exact: false }).fill('anpr-headers');
  await dlg().getByLabel('Header names').fill('Authorization'); await dlg().getByLabel('Header names').press('Enter');
  await dlg().locator('[data-map=probeId]').fill('corridor'); await dlg().locator('[data-map=minutes]').fill('travel.mins');
  assert.equal(await dlg().getByLabel('Mode').inputValue(), 'shadow', 'new connectors default to shadow');
  await dlg().locator('#connector-save').click(); await toast('Created ANPR speed poll');
  const row = page.locator('tr[data-connector="ANPR speed poll"]'); await row.waitFor(); assert.match(await row.innerText(), /shadow/);
  const st = (await serverState()).connectors.find((c) => c.name === 'ANPR speed poll');
  assert.equal(st.secretRef, 'anpr-headers'); assert.deepEqual(st.config.headerNames, ['Authorization']); assert.ok(!JSON.stringify(st).includes('AIza'));
  // test (dry run)
  await row.getByRole('button', { name: 'Test ANPR speed poll' }).click(); await dlg().locator('[data-testresult=ok]').waitFor();
  assert.match(await dlg().innerText(), /Reachable/); assert.match(await dlg().innerText(), /externalId/); await dlg().getByRole('button', { name: 'Close' }).click();
  // run now
  await row.getByRole('button', { name: 'Run ANPR speed poll now' }).click(); await toast('5 records'); await toast('shadow: not applied');
  await page.waitForFunction(() => document.querySelector('tr[data-connector="ANPR speed poll"]')?.innerText.includes('Healthy'));
  // history drawer
  await row.getByRole('button', { name: 'History of ANPR speed poll' }).click(); await dlg().locator('table').waitFor(); assert.match(await dlg().innerText(), /OK/); await dlg().getByRole('button', { name: 'Close' }).last().click();
  // disable
  await row.getByRole('switch', { name: 'Disable ANPR speed poll' }).evaluate((e) => e.click()); await toast('disabled');
  await page.waitForFunction(() => document.querySelector('tr[data-connector="ANPR speed poll"]')?.innerText.includes('Disabled'));
  assert.equal((await serverState()).connectors.find((c) => c.name === 'ANPR speed poll').enabled, false);
  // failing test result is shown without breaking
  await page.locator('tr[data-connector="ASTraM incidents"]').getByRole('button', { name: 'Edit ASTraM incidents' }).click();
  await dlg().getByLabel('Endpoint URL').fill('https://fail.example.gov.in/x'); await dlg().locator('#connector-save').click(); await toast('Saved ASTraM incidents');
  await page.locator('tr[data-connector="ASTraM incidents"]').getByRole('button', { name: 'Test ASTraM incidents' }).click(); await dlg().locator('[data-testresult=fail]').waitFor(); assert.match(await dlg().innerText(), /HTTP 502/); await dlg().getByRole('button', { name: 'Close' }).click();
  // delete with confirm
  await row.getByRole('button', { name: 'Delete ANPR speed poll' }).click(); await dlg().getByRole('button', { name: 'Delete connector' }).click(); await toast('Deleted');
  await page.waitForFunction(() => !document.querySelector('tr[data-connector="ANPR speed poll"]'));
});

test('connectors: paid type needs cap and probes; integration guide shows curl with placeholder key', async () => {
  await open('connectors');
  await page.click('#add-connector'); await dlg().getByLabel('Connector type').selectOption('tomtom');
  await dlg().getByLabel('Name', { exact: false }).first().fill('TomTom corridors'); await dlg().locator('#connector-save').click();
  const t = await dlg().locator('.errsum').innerText(); assert.match(t, /daily call cap/i); assert.match(t, /Pick at least one probe/); assert.match(t, /secret name/i);
  await dlg().getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.catalog [data-type=webhook]').getByRole('button', { name: 'Integration guide' }).click();
  const g = await dlg().innerText(); assert.match(g, /curl -sS -X POST/); assert.match(g, /\$BLR_API_KEY/); assert.match(g, /\/ingest\/v1\/events/); assert.match(g, /\/ingest\/v1\/speeds/); assert.match(g, /\/ingest\/v1\/works/);
  await page.waitForTimeout(500); await shot('dlg-integration-guide'); await dlg().getByRole('button', { name: 'Close' }).last().click();
});

test('probes: create from hub to station and via validation; shows observations and calibration', async () => {
  await open('probes');
  assert.match(await page.locator('tr[data-probe="CBD to Whitefield"]').innerText(), /52 min/); assert.match(await page.locator('.card', { hasText: 'Calibration' }).innerText(), /9\.1%/);
  await page.click('#add-probe'); await dlg().locator('#probe-save').click(); assert.match(await dlg().locator('.errsum').innerText(), /Name/);
  await dlg().getByLabel('Name', { exact: false }).fill('CBD to Electronic City');
  await dlg().getByLabel(/^From/).selectOption({ label: MAP.hubs[0].n }); await dlg().getByLabel(/^To/).selectOption({ label: MAP.hubs[0].n });
  await dlg().locator('#probe-save').click(); assert.match(await dlg().locator('.errsum').innerText(), /must differ/);
  await dlg().getByLabel(/^To/).selectOption({ label: MAP.hubs[2].n });
  await page.waitForFunction(() => +document.querySelector('[role=dialog] input[type=number][min="1"]')?.value > 0);
  assert.match(await dlg().locator('#free-suggest').innerText(), /Estimated/);
  await dlg().locator('#probe-save').click(); await toast('Created CBD to Electronic City');
  const p = (await serverState()).probes.find((x) => x.name === 'CBD to Electronic City'); assert.equal(p.fromNode, MAP.hubs[0].node); assert.equal(p.toNode, MAP.hubs[2].node); assert.ok(p.freeMin >= 1);
  await page.locator('tr[data-probe="CBD to Electronic City"]').waitFor();
  // map pick sets a node
  await page.locator('tr[data-probe="CBD to Electronic City"]').getByRole('button', { name: 'Edit CBD to Electronic City' }).click();
  const cv = dlg().locator('canvas'); const bb = await cv.boundingBox(); await cv.click({ position: { x: bb.width * 0.5, y: bb.height * 0.5 } });
  assert.match(await dlg().getByLabel(/^From/).evaluate((s) => s.selectedOptions[0].text), /Map point/); await dlg().getByRole('button', { name: 'Cancel' }).click();
});

test('works CSV import: dry run shows accepted/rejected with reasons, then confirm imports', async () => {
  await open('works');
  const csv = 'name,road,station,from,to,hours,cap,kind,agency\nBridge repair,Old Madras Road,Indiranagar,2026-11-01,2026-11-20,night,0.5,bridge,GBA\nGhost work,Nowhere Rd,Atlantis,2026-11-01,2026-11-20,all,0.5,x,GBA\nBad dates,Hosur Road,Adugodi,01/11/2026,2026-11-20,all,0.5,x,GBA\nWide road,Bellary Road,Hebbala,2026-12-01,2026-12-31,peak,0.8,utility,BESCOM';
  await page.locator('#imp-works-text').fill(csv); assert.equal(await page.locator('#imp-works-apply').isDisabled(), true);
  await page.click('#imp-works-check'); await page.locator('[data-dryrun=done]').waitFor();
  const t = await page.locator('[data-dryrun=done]').innerText(); assert.match(t, /2 will be accepted/); assert.match(t, /2 rejected/); assert.match(t, /unknown station "Atlantis"/); assert.match(t, /YYYY-MM-DD/);
  assert.equal((await serverState()).works.length, 4, 'dry run wrote nothing');
  assert.equal(await page.locator('#imp-works-apply').innerText(), 'Import 2 rows');
  await page.locator('#imp-works-text').fill(csv + '\n'); assert.equal(await page.locator('#imp-works-apply').isDisabled(), true, 'editing invalidates the dry run');
  await page.click('#imp-works-check'); await page.locator('[data-dryrun=done]').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download rejected' }).click()]); assert.match(dl.suggestedFilename(), /rejected\.csv/);
  await page.click('#imp-works-apply'); await dlg().getByRole('button', { name: 'Import 2 rows' }).click(); await toast('Imported 2 rows, 2 rejected');
  const s = await serverState(); assert.equal(s.works.filter((w) => w.source === 'csv' && /Bridge|Wide/.test(w.name)).length, 2);
  await page.waitForFunction(() => document.body.innerText.includes('Bridge repair'));
  // header problems are caught before any request
  await page.locator('#imp-works-text').fill('name,road\nx,y'); await page.click('#imp-works-check'); assert.match(await page.locator('#imp-works-text').locator('xpath=ancestor::section').innerText(), /Missing required columns: station, from, to/);
  // export
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#works-export')]); assert.equal(dl2.suggestedFilename(), 'works.csv');
});

test('crash CSV import dry run and confirm; incidents tab and exports', async () => {
  await open('works'); await page.getByRole('tab', { name: 'Crash records' }).click();
  await page.locator('#imp-crash-text').fill('station,year,fatal,nonfatal\nHalasooru,2025,12,34\nNowhere,2025,1,1\nIndiranagar,2025,x,5');
  await page.click('#imp-crash-check'); await page.locator('[data-dryrun=done]').waitFor(); const t = await page.locator('[data-dryrun=done]').innerText(); assert.match(t, /1 will be accepted/); assert.match(t, /2 rejected/); assert.match(t, /whole numbers/);
  await page.click('#imp-crash-apply'); await dlg().getByRole('button', { name: 'Import 1 rows' }).click(); await toast('Imported 1 rows');
  await page.getByRole('tab', { name: 'Incidents' }).click(); await page.waitForSelector('text=breakdown');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#export-actions')]); assert.match(d1.suggestedFilename(), /^actions-/);
});

test('API keys: plaintext shown once, listed by prefix only, revoke', async () => {
  await open('apikeys');
  await page.getByRole('button', { name: '+ Create key' }).click(); await dlg().getByRole('button', { name: 'Create key' }).click(); assert.match(await dlg().locator('.errsum').innerText(), /Name/);
  await dlg().getByLabel('Name', { exact: false }).fill('Test vendor'); await dlg().getByRole('button', { name: 'Create key' }).click(); assert.match(await dlg().innerText(), /Pick at least one scope|Scopes/);
  await dlg().getByLabel('events').check(); await dlg().getByLabel('speeds').check(); await dlg().getByRole('button', { name: 'Create key' }).click();
  const box = page.locator('#plaintext-key'); await box.waitFor(); const key = (await box.innerText()).trim(); assert.match(key, /^blr_[0-9a-f]{48}$/); assert.match(await dlg().innerText(), /shown once/);
  await page.getByRole('button', { name: 'Copy key' }).click(); await page.getByText('Copied to clipboard').waitFor(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), key);
  await page.keyboard.press('Escape'); assert.ok(await dlg().count(), 'plaintext dialog is not dismissed by Escape');
  await dlg().getByRole('button', { name: 'I have stored the key' }).click(); await dlg().waitFor({ state: 'detached' });
  const row = page.locator('tr[data-keyname="Test vendor"]'); await row.waitFor(); const rt = await row.innerText(); assert.ok(rt.includes(key.slice(0, 8)) && !rt.includes(key), 'only the prefix is listed');
  await page.reload(); await page.waitForSelector('tr[data-keyname="Test vendor"]'); assert.ok(!(await page.content()).includes(key), 'plaintext never returns');
  const s = await serverState(); assert.ok(!JSON.stringify(s.apikeys).includes(key), 'server stores a hash, not the key');
  await page.locator('tr[data-keyname="Test vendor"]').getByRole('button', { name: 'Revoke key Test vendor' }).click(); await dlg().getByRole('button', { name: 'Revoke key' }).click(); await toast('Revoked Test vendor');
  await page.waitForFunction(() => !document.querySelector('tr[data-keyname="Test vendor"]')); await page.getByLabel('Show revoked keys').check(); assert.match(await page.locator('tr[data-keyname="Test vendor"]').innerText(), /Revoked/);
});

test('AI kill switch requires a reason, then flips state and can be restored', async () => {
  await open('ai'); assert.match(await page.locator('#ai-state').innerText(), /AI is on/);
  await page.click('#ai-kill'); await dlg().getByRole('button', { name: 'Turn AI off' }).click(); assert.match(await dlg().locator('.errsum').innerText(), /Reason/);
  await dlg().getByLabel('Reason', { exact: false }).fill('Spend spike on Tuesday'); await dlg().getByRole('button', { name: 'Turn AI off' }).click(); await toast('AI is off');
  await page.waitForFunction(() => document.querySelector('#ai-state')?.innerText.includes('AI is off'));
  let s = await serverState(); assert.equal(s.settings.ai.enabled, false); assert.equal(s.settings.ai.killReason, 'Spend spike on Tuesday'); assert.ok(s.audit.some((a) => a.kind === 'ai.kill' && /Spend spike/.test(a.summary)));
  assert.match(await page.locator('.kill-card').innerText(), /Spend spike/);
  await page.click('#ai-kill'); await dlg().getByLabel('Reason', { exact: false }).fill('Budget reviewed'); await dlg().getByRole('button', { name: 'Turn AI on' }).click(); await toast('AI is on');
  assert.equal((await serverState()).settings.ai.enabled, true);
});

test('AI limits editor validates and saves; charts are accessible', async () => {
  await open('ai');
  assert.ok(await page.locator('svg.chart[aria-label*="Model calls per day"]').count()); assert.ok((await page.locator('svg.chart g.col[role=img]').count()) >= 14);
  const label = await page.locator('svg.chart g.col').first().getAttribute('aria-label'); assert.match(label, /t0|Templates/);
  assert.ok((await page.locator('table.sr').count()) >= 3, 'each chart has a data table');
  const cap = page.getByLabel('Global daily call cap'); await cap.fill('-5'); await page.click('#ai-limits-save'); assert.match(await page.locator('.errsum').last().innerText(), /Global daily call cap/);
  await cap.fill('1200'); await page.getByLabel('Model id for t2').fill(''); await page.click('#ai-limits-save'); assert.match(await page.locator('.errsum').last().innerText(), /Model id \(t2\)/);
  await page.getByLabel('Model id for t2').fill('gemini-2.5-flash-002'); await page.click('#ai-limits-save'); await toast('AI limits saved');
  const ai = (await serverState()).settings.ai; assert.equal(ai.dailyCallCap, 1200); assert.equal(ai.tiers.t2.model, 'gemini-2.5-flash-002');
});

test('settings: validation, diff before save, confirm persists', async () => {
  await open('settings');
  await page.getByLabel('Tick interval', { exact: false }).fill('30'); await page.click('#settings-save');
  assert.match(await page.locator('.errsum').first().innerText(), /Stale after/); assert.match(await page.locator('.ferr:not(.hide)').first().innerText(), /twice|2x/);
  await page.getByLabel('Stale after', { exact: false }).fill('90'); await page.getByLabel('Feed mode').selectOption('live'); await page.getByRole('switch', { name: 'Maintenance mode' }).evaluate((e) => e.click());
  await page.click('#settings-save'); await dlg().waitFor();
  const d = await dlg().innerText(); assert.match(d, /Save 4 changes/); assert.match(d, /Tick interval/); assert.match(d, /10/); assert.match(d, /30/); assert.match(d, /Maintenance on pauses the feed/); assert.match(d, /Feed mode changes from blend to live/);
  assert.equal((await serverState()).settings.feed.tickMin, 10, 'nothing saved before confirm');
  await dlg().getByRole('button', { name: 'Back to editing' }).click(); assert.equal((await serverState()).settings.feed.tickMin, 10);
  await page.click('#settings-save'); await page.click('#settings-confirm'); await toast('Settings saved');
  const s = (await serverState()).settings; assert.deepEqual([s.feed.mode, s.feed.tickMin, s.feed.staleAfterMin, s.maintenance], ['live', 30, 90, true]);
  await page.locator('#maint').waitFor({ state: 'visible' }); assert.match(await page.locator('#maint').innerText(), /Maintenance/);
  await page.click('#settings-save'); await toast('No changes to save');
});

test('settings: map views and layers are saved and validated', async () => {
  await open('settings');
  await page.getByLabel('Slow below (km/h)').fill('10'); await page.click('#settings-save');
  assert.match(await page.locator('#map-card').innerText(), /Must be higher than/);
  await page.getByLabel('Slow below (km/h)').fill('20');
  await page.locator('[aria-label="safety for viewer"]').check({ force: true }); await page.locator('[aria-label="Road works"]').uncheck({ force: true });
  await page.getByLabel('Default view').selectOption('speed');
  await page.click('#settings-save'); await dlg().waitFor();
  assert.match(await dlg().innerText(), /Map: default view/); assert.match(await dlg().innerText(), /Map layer: Road works/);
  await page.click('#settings-confirm'); await toast('Settings saved');
  const m = (await serverState()).settings.map; assert.deepEqual([m.defaultView, m.views.safety.viewer, m.layers.works, m.speedBands.moderate], ['speed', true, false, 20]);
});

test('overview: quick actions (checks, pause feed, AI kill) work', async () => {
  await open('overview');
  assert.match(await page.locator('[data-kpi=checks]').innerText(), /3\/5/); assert.match(await page.locator('[data-kpi=esc] .v').innerText(), /1/); assert.match(await page.locator('[data-kpi=online]').innerText(), /^Users online\s+2/);
  await page.click('#qa-checks'); await toast('1 failing'); 
  await page.click('#qa-feed'); await dlg().getByRole('button', { name: 'Pause feed' }).click(); await toast('Feed paused');
  assert.equal((await serverState()).settings.maintenance, true); await page.locator('.banner', { hasText: 'Maintenance mode is on' }).waitFor();
  await page.click('#qa-ai'); await dlg().getByLabel('Reason', { exact: false }).fill('Testing kill switch'); await dlg().getByRole('button', { name: 'Turn AI off' }).click(); await toast('AI is off');
  await page.locator('.banner', { hasText: 'AI is switched off' }).waitFor(); assert.equal((await serverState()).settings.ai.enabled, false);
});

test('system checks: run now refreshes results and keeps history', async () => {
  await open('checks'); assert.match(await page.locator('tr[data-check=connectors]').innerText(), /Failing/);
  await api('PATCH', '/admin/connectors/c4', { enabled: false });
  await page.click('#run-checks'); await toast('Checks finished'); await page.waitForFunction(() => document.querySelector('tr[data-check=connectors]')?.innerText.includes('OK'));
  assert.match(await page.locator('.page').innerText(), /Earlier results this session/);
});

test('audit: filter by kind and actor, paginate, expand meta, export CSV', async () => {
  await open('audit');
  await page.waitForSelector('tbody tr'); assert.equal(await page.locator('tbody tr').count(), 50);
  await page.click('#audit-more'); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 100);
  await page.click('#audit-more'); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 131); assert.equal(await page.locator('#audit-more').count(), 0); assert.match(await page.locator('[role=status]').last().innerText(), /end of log/);
  const btn = page.locator('tbody tr button[aria-controls]').first(); await btn.click(); assert.equal(await btn.getAttribute('aria-expanded'), 'true'); await page.locator('pre.code').first().waitFor({ state: 'visible' }); await btn.click(); assert.equal(await btn.getAttribute('aria-expanded'), 'false');
  await page.getByLabel('Kind').fill('settings.update'); await page.click('button:has-text("Apply")');
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('tbody tr')]; return r.length > 0 && r.length < 50 && r.every((x) => x.dataset.kind === 'settings.update'); });
  await page.getByLabel('Actor').fill('ops@'); await page.click('button:has-text("Apply")'); await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].every((x) => x.innerText.includes('ops@blr.test')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#audit-export')]); assert.match(dl.suggestedFilename(), /^audit-.*\.csv$/);
  const csv = readFileSync(await dl.path(), 'utf8'); assert.match(csv, /^id,at,actor/); assert.ok(csv.split('\n').filter((l) => l.includes('settings.update')).length > 2); assert.ok(!csv.split('\n').slice(1).filter(Boolean).some((l) => !l.includes('ops@blr.test')), 'export honours filters');
  await page.getByLabel('Kind').fill('nonexistent.kind'); await page.click('button:has-text("Apply")'); await page.getByText('No audit entries match').waitFor();
  await page.getByLabel('From (IST)').fill('2026-10-07'); await page.getByRole('button', { name: 'Clear filters' }).click(); await page.waitForSelector('tbody tr');
});

test('mutations are written to the audit log', async () => {
  await open('users'); await page.getByRole('button', { name: '+ Add user' }).click(); await dlg().getByLabel('Email').fill('audit.me@blr.test'); await dlg().getByRole('button', { name: 'Add user' }).click(); await toast('Added');
  const s = await serverState(); assert.ok(s.audit.some((a) => a.kind === 'user.create' && a.target === 'users/audit.me@blr.test' && a.actor === 'admin@blr.test'));
});

test('stations: edit coordinates + verify; territories upload validates, previews, publishes and reverts', async () => {
  await open('stations');
  assert.equal(await page.locator('tbody tr[data-station]').count(), 62); assert.match(await page.locator('.kpi', { hasText: 'Verified stations' }).innerText(), /0 \/ 62/);
  assert.ok((await page.locator('tbody tr[data-station]', { hasText: 'Approximate' }).count()) >= 6, 'approx sources are flagged');
  await page.locator('tr[data-station=Indiranagar]').getByRole('button', { name: 'Edit Indiranagar' }).click();
  await dlg().getByLabel('Latitude').fill('50'); await dlg().locator('#station-save').click(); assert.match(await dlg().locator('.errsum').innerText(), /Latitude/);
  await dlg().getByLabel('Latitude').fill('12.9784'); await dlg().getByLabel('Longitude').fill('77.6408'); await dlg().getByLabel('Aliases').fill('Indira Nagar, Indranagar'); await dlg().getByRole('switch').evaluate((e) => e.click());
  await dlg().locator('#station-save').click(); await toast('Saved Indiranagar');
  await page.waitForFunction(() => document.querySelector('tr[data-station=Indiranagar]')?.innerText.includes('Verified'));
  assert.match(await page.locator('tr[data-station=Indiranagar]').innerText(), /12\.9784, 77\.6408/); assert.match(await page.locator('tr[data-station=Indiranagar]').innerText(), /Indira Nagar/);
  await page.getByLabel('Unverified only').check(); assert.equal(await page.locator('tbody tr[data-station]').count(), 61);
  // territories: invalid file
  const bad = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { station: 'Atlantis' }, geometry: { type: 'Polygon', coordinates: [[[77.6, 12.9], [77.61, 12.9], [77.61, 12.91], [77.6, 12.9]]] } }] };
  await page.setInputFiles('#terr-file', { name: 'bad.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await page.locator('#territories .banner.bad').waitFor(); assert.match(await page.locator('#territories .banner.bad').innerText(), /not a known station/); assert.equal(await page.locator('#terr-publish').isDisabled(), true);
  await page.setInputFiles('#terr-file', { name: 'x.geojson', mimeType: 'application/json', buffer: Buffer.from('{nope') }); await page.getByText('not valid JSON').waitFor();
  // valid file derived from built-in polygons (first 10 stations)
  const gj = { type: 'FeatureCollection', features: MAP.st.slice(0, 10).map((s) => ({ type: 'Feature', properties: { station: s.n }, geometry: { type: 'Polygon', coordinates: s.poly.map((r) => r.map(([x, y]) => [77.4 + x / 50000, 12.8 + y / 50000])) } })) };
  await page.setInputFiles('#terr-file', { name: 'official.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(gj)) });
  await page.locator('#territories .banner.info').waitFor(); assert.match(await page.locator('#territories').innerText(), /10 stations/); assert.match(await page.locator('#territories').innerText(), /52 stations have no polygon/);
  await page.locator('#territories').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot('_territory-preview');
  await page.click('#terr-publish'); await dlg().getByRole('button', { name: 'Publish' }).click(); await toast('Boundaries published');
  await page.locator('#territories .badge', { hasText: 'Official boundaries active' }).waitFor();
  await page.click('#terr-revert'); await dlg().getByRole('button', { name: 'Revert' }).click(); await toast('Reverted'); await page.locator('#territories .badge', { hasText: 'Built-in approximate' }).waitFor();
});

test('light and dark themes apply; tokens switch', async () => {
  await open('overview');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); const light = await bg();
  await page.getByRole('button', { name: 'Toggle light or dark theme' }).click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark'); const dark = await bg();
  assert.notEqual(light, dark); assert.equal(light, 'rgb(243, 245, 248)');
  await page.getByRole('button', { name: 'Toggle light or dark theme' }).click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
});

test('every page renders without console errors, with a single h1 and labelled controls', async () => {
  await login(); await page.waitForSelector('.shell');
  for (const id of ['overview', 'checks', 'audit', 'users', 'apikeys', 'stations', 'works', 'probes', 'connectors', 'ai', 'settings']) {
    await page.goto(`${mock.url}/#/${id}`); await page.waitForSelector(`.page[data-page=${id}] h1`); await page.waitForFunction(() => !document.querySelector('.sk-wrap'));
    assert.equal(await page.locator('h1').count(), 1, id);
    const unlabelled = await page.evaluate(() => [...document.querySelectorAll('.page input:not([type=hidden]):not([type=file]), .page select, .page textarea')].filter((e) => !(e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))).map((e) => e.id || e.outerHTML.slice(0, 60)));
    assert.deepEqual(unlabelled, [], `unlabelled controls on ${id}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `horizontal page scroll on ${id}`);
  }
});

test('API failure shows an error state with retry (no blank page)', async () => {
  await login(); await page.waitForSelector('.shell');
  await page.route('**/api/admin/apikeys', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Store unavailable' } }) }));
  await page.goto(`${mock.url}/#/apikeys`); await page.getByText('Could not load this').waitFor(); assert.match(await page.locator('.page').innerText(), /Store unavailable/);
  await page.unroute('**/api/admin/apikeys'); await page.getByRole('button', { name: 'Try again' }).click(); await page.waitForSelector('tr[data-keyname]');
});

test('screenshots', async () => {
  await open('overview'); await page.waitForTimeout(300); await shot('overview');
  await page.goto(`${mock.url}/#/users`); await page.waitForSelector('tr[data-email]'); await shot('users');
  await page.goto(`${mock.url}/#/connectors`); await page.waitForSelector('tr[data-connector]'); await page.waitForTimeout(500); await shot('connectors');
  await page.goto(`${mock.url}/#/ai`); await page.waitForSelector('svg.chart'); await page.waitForTimeout(200); await shot('ai-cost');
  await page.goto(`${mock.url}/#/audit`); await page.waitForSelector('tbody tr'); await shot('audit');
  await page.goto(`${mock.url}/#/probes`); await page.waitForSelector('tr[data-probe]'); await page.waitForTimeout(300); await shot('probes');
  await page.goto(`${mock.url}/#/stations`); await page.waitForSelector('tr[data-station]'); await page.locator('#territories').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot('stations-territories');
  await page.goto(`${mock.url}/#/settings`); await page.waitForSelector('#settings-save'); await shot('settings'); { const vp = page.viewportSize(); await page.setViewportSize({ width: 1280, height: 2400 }); await page.waitForTimeout(300); await page.locator('#map-card').screenshot({ path: join(SHOTS, 'settings-map.png') }); await page.setViewportSize(vp); }
  await page.getByLabel('Tick interval', { exact: false }).fill('5'); await page.getByLabel('Feed mode').selectOption('live'); await page.click('#settings-save'); await dlg().waitFor(); await page.waitForTimeout(300); await shot('dlg-settings-diff'); await dlg().getByRole('button', { name: 'Back to editing' }).click();
  await page.goto(`${mock.url}/#/users`); await page.waitForSelector('tr[data-email]'); await page.getByRole('button', { name: '+ Add user' }).click(); await dlg().getByLabel('Role').first().selectOption('station'); await dlg().getByRole('button', { name: 'Add user' }).click(); await page.waitForTimeout(300); await shot('dlg-add-user'); await page.keyboard.press('Escape');
  await page.goto(`${mock.url}/#/connectors`); await page.waitForSelector('tr[data-connector]'); await page.click('#add-connector'); await dlg().getByLabel('Name', { exact: false }).first().fill('ASTraM'); await dlg().locator('#connector-save').click(); await page.waitForTimeout(300); await shot('dlg-add-connector'); await page.keyboard.press('Escape');
  await page.goto(`${mock.url}/#/probes`); await page.waitForSelector('tr[data-probe]'); await page.click('#add-probe'); await dlg().getByLabel(/^From/).selectOption({ label: MAP.hubs[5].n }); await dlg().getByLabel(/^To/).selectOption({ label: MAP.hubs[3].n }); await page.waitForTimeout(400); await shot('dlg-add-probe'); await page.keyboard.press('Escape');
  await page.goto(`${mock.url}/#/apikeys`); await page.waitForSelector('tr[data-keyname]'); await page.getByRole('button', { name: '+ Create key' }).click(); await dlg().getByLabel('Name', { exact: false }).fill('Shot vendor'); await dlg().getByLabel('events').check(); await dlg().getByRole('button', { name: 'Create key' }).click(); await page.locator('#plaintext-key').waitFor(); await page.waitForTimeout(300); await shot('dlg-api-key-once'); await dlg().getByRole('button', { name: 'I have stored the key' }).click();
  await page.goto(`${mock.url}/#/stations`); await page.waitForSelector('tr[data-station]'); await page.locator('tr[data-station=Indiranagar]').getByRole('button', { name: 'Edit Indiranagar' }).click(); await page.waitForTimeout(400); await shot('dlg-edit-station'); await page.keyboard.press('Escape');
  await page.goto(`${mock.url}/#/works`); await page.waitForSelector('#imp-works-text'); await page.locator('#imp-works-text').fill('name,road,station,from,to,hours,cap,kind,agency\nBridge repair,Old Madras Road,Indiranagar,2026-11-01,2026-11-20,night,0.5,bridge,GBA\nGhost work,Nowhere Rd,Atlantis,2026-11-01,2026-11-20,all,0.5,x,GBA'); await page.click('#imp-works-check'); await page.locator('[data-dryrun=done]').waitFor(); await page.locator('[data-import=works]').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot('works-import-dryrun');
  await page.goto(`${mock.url}/#/overview`); await page.waitForSelector('[data-kpi]'); await page.getByRole('button', { name: 'Toggle light or dark theme' }).click(); await page.waitForTimeout(300); await shot('dark-overview');
  await page.goto(`${mock.url}/#/connectors`); await page.waitForSelector('tr[data-connector]'); await page.waitForTimeout(400); await shot('dark-connectors');
  await page.setViewportSize({ width: 820, height: 1100 }); await page.goto(`${mock.url}/#/overview`); await page.waitForSelector('[data-kpi]'); await page.waitForTimeout(300); await shot('tablet-overview');
  await page.goto(`${mock.url}/#/connectors`); await page.waitForSelector('tr[data-connector]'); await page.waitForTimeout(400); await shot('tablet-connectors');
  await page.goto(`${mock.url}/#/users`); await page.waitForSelector('tr[data-email]'); await shot('tablet-users');
});

test('welcome: signing in lands on a greeting + checks first; Enter opens the console; refresh goes straight in', async () => {
  await page.goto(mock.url + '/?welcome=1'); await page.fill('#dev-email', 'admin@blr.test'); await page.click('button[type=submit]');
  await page.getByTestId('welcome').waitFor();
  assert.equal(await page.getByTestId('welcome').getAttribute('data-variant'), 'admin-site');
  assert.match(await page.locator('.wl-h').innerText(), /engine room/); assert.match(await page.locator('.wl-sub').innerText(), /Users, feeds, probes and AI limits/);
  await page.waitForFunction(() => !document.querySelector('[data-testid=welcome-enter]').disabled);
  assert.equal(await page.locator('.wl-row').count(), 5); assert.equal(await page.locator('.wl-row.warn').count(), 1, 'system health reports its one warning');
  assert.equal(await page.locator('.shell').count(), 0, 'console is not mounted before Enter');
  await page.getByTestId('welcome-enter').click(); await page.waitForSelector('.shell');
  await page.reload(); await page.waitForSelector('.shell'); assert.equal(await page.getByTestId('welcome').count(), 0);
});
