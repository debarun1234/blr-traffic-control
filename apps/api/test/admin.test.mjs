import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { nodeLatLon } from '@blr/core';
import { makeApp, em, net, json, T0 } from './helpers.mjs';

let T, feed = { data: { items: [] } };
before(async () => { T = await makeApp({ fetch: async () => json(feed) }); });
after(() => T.app.close());
const A = (m, u, b, h) => T.call('admin', m, u, b, h);
const kinds = async () => (await T.store.list('audit')).map((a) => a.kind);

test('users: create, validate, update, duplicate; self and last-admin safeguards; disabled users lose access immediately', async () => {
  const mk = (b) => A('POST', '/api/admin/users', b);
  assert.equal((await mk({ email: 'New.User@Example.test', name: 'N', role: 'dcp', region: 'East' })).status, 201);
  const u = (await T.store.get('users', 'new.user@example.test')); assert.deepEqual([u.role, u.region, u.active, u.createdBy], ['dcp', 'East', true, em('admin')]);
  assert.equal((await mk({ email: 'new.user@example.test', role: 'viewer' })).status, 409);
  for (const bad of [{ email: 'nope', role: 'viewer' }, { email: 'a@b.co', role: 'god' }, { email: 'a@b.co', role: 'dcp' }, { email: 'a@b.co', role: 'station', station: 'Atlantis' }, { email: 'a@b.co', role: 'viewer', extra: 1 }]) assert.equal((await mk(bad)).status, 400, JSON.stringify(bad));
  const p = await A('PATCH', '/api/admin/users/new.user@example.test', { role: 'station', station: 'Indiranagar' }); assert.equal(p.status, 200); assert.deepEqual([p.body.role, p.body.station, p.body.region], ['station', 'Indiranagar', undefined]);
  // cannot demote / disable self
  assert.equal((await A('PATCH', `/api/admin/users/${em('admin')}`, { role: 'viewer' })).status, 409);
  assert.equal((await A('PATCH', `/api/admin/users/${em('admin')}`, { active: false })).status, 409);
  assert.equal((await A('DELETE', `/api/admin/users/${em('admin')}`)).status, 409);
  assert.equal((await A('PATCH', `/api/admin/users/${em('admin')}`, { name: 'Renamed' })).status, 200, 'non-demoting self edits are fine');
  // second admin: can be demoted by the first; then the first is the last admin and still cannot self-remove
  await mk({ email: 'admin2@example.test', role: 'admin' });
  assert.equal((await T.call('admin2@example.test', 'GET', '/api/admin/users')).status, 200);
  assert.equal((await A('PATCH', '/api/admin/users/admin2@example.test', { role: 'viewer' })).status, 200);
  assert.equal((await T.call('admin2@example.test', 'GET', '/api/admin/users')).status, 403, 'role change takes effect immediately (cache invalidated)');
  assert.equal((await A('DELETE', `/api/admin/users/${em('admin')}`)).status, 409);
  // soft delete
  assert.equal((await A('DELETE', '/api/admin/users/new.user@example.test')).body.active, false);
  assert.equal((await T.call('new.user@example.test', 'GET', '/api/me')).status, 403);
  assert.equal((await A('DELETE', '/api/admin/users/nobody@example.test')).status, 404);
  assert.ok((await A('GET', '/api/admin/users')).body.users.length >= 10);
  const k = await kinds(); for (const x of ['user_create', 'user_update', 'user_disable']) assert.ok(k.includes(x), x);
});

test('settings: validated, unknown keys rejected, deep-merged, audited', async () => {
  assert.equal((await A('GET', '/api/admin/settings')).body.settings.feed.tickMin, 10);
  for (const bad of [{ feed: { mode: 'x' } }, { surprise: 1 }, { feed: { tickMin: 'ten' } }, { ai: { perUserDaily: { root: 3 } } }, { caps: { routesCallsPerDay: -1 } }]) assert.equal((await A('PUT', '/api/admin/settings', bad)).status, 400, JSON.stringify(bad));
  const ok = await A('PUT', '/api/admin/settings', { feed: { tickMin: 5 }, caps: { routesCallsPerDay: 100 } });
  assert.equal(ok.status, 200); assert.equal(ok.body.settings.feed.tickMin, 5); assert.equal(ok.body.settings.feed.staleAfterMin, 25); assert.equal(ok.body.settings.caps.routesCallsPerDay, 100);
  assert.equal((await A('GET', '/api/admin/settings')).body.settings.feed.tickMin, 5); assert.ok((await kinds()).includes('settings_update'));
  await A('PUT', '/api/admin/settings', { feed: { tickMin: 10 }, caps: { routesCallsPerDay: 500 } });
});

test('stations and territories: overrides stored, geojson validated, revert to built-in', async () => {
  const s = (await A('GET', '/api/admin/stations')).body; assert.equal(s.stations.length, net.map.st.length); assert.ok(s.stations[0].lat > 12 && s.stations[0].lat < 14); assert.equal(s.crash.stations, 0);
  const name = net.map.st[2].n;
  const p = await A('PATCH', `/api/admin/stations/${encodeURIComponent(name)}`, { lat: 12.97, lon: 77.6, aliases: ['Alias One'], notes: 'checked', verified: true }); assert.equal(p.status, 200);
  const again = (await A('GET', '/api/admin/stations')).body.stations.find((x) => x.name === name); assert.deepEqual([again.lat, again.lon, again.override.verified], [12.97, 77.6, true]);
  assert.equal((await A('PATCH', '/api/admin/stations/Atlantis', { verified: true })).status, 404); assert.equal((await A('PATCH', `/api/admin/stations/${encodeURIComponent(name)}`, { lat: 40, lon: 77.6 })).status, 400);
  const ring = [[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 13.0], [77.5, 12.9]];
  const gj = (props, ringx = ring) => ({ geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ringx] } }] } });
  assert.equal((await A('GET', '/api/admin/territories')).body.source, 'built-in');
  for (const bad of [gj({ station: 'Atlantis' }), gj({ station: name }, ring.slice(0, 4)), gj({ station: name }, [[0, 0], [1, 0], [1, 1], [0, 0]]), { geojson: { type: 'Feature' } }, {}]) assert.equal((await A('PUT', '/api/admin/territories', bad)).status, 400);
  assert.equal((await A('PUT', '/api/admin/territories', gj({ station: name }))).status, 200);
  assert.equal((await A('GET', '/api/admin/territories')).body.source, 'custom'); assert.equal((await A('DELETE', '/api/admin/territories')).body.source, 'built-in'); assert.equal(await T.store.get('territories', 'current'), null);
});

test('connectors: create/validate (no secrets in config), test is a dry run, run writes, runs list, circuit state, delete', async () => {
  const cfg = { url: 'https://feed.example.org/x', target: 'incidents', itemsPath: '$.data.items', map: { externalId: '$.id', type: '$.t', lat: '$.lat', lon: '$.lon', durationMin: '$.m' } };
  assert.equal((await A('POST', '/api/admin/connectors', { type: 'rest', name: 'Bad', config: { ...cfg, apiKey: 'abc' } })).status, 400);
  assert.equal((await A('POST', '/api/admin/connectors', { type: 'google_routes', name: 'NoSecret', config: {} })).status, 400);
  assert.equal((await A('POST', '/api/admin/connectors', { type: 'nope', name: 'x', config: {} })).status, 400);
  const c = await A('POST', '/api/admin/connectors', { type: 'rest', name: 'City feed', intervalMin: 5, config: cfg }); assert.equal(c.status, 201); assert.equal(c.body.enabled, false);
  const id = c.body.id, p = nodeLatLon(net, net.a[300]);
  feed = { data: { items: [{ id: 'Z1', t: 'Accident', lat: p.lat, lon: p.lon, m: 30 }] } };
  const t = await A('POST', `/api/admin/connectors/${id}/test`); assert.equal(t.body.ok, true); assert.equal(t.body.sample.length, 1); assert.equal((await T.store.list('incidents', { where: [['connectorId', '==', id]] })).length, 0);
  const r = await A('POST', `/api/admin/connectors/${id}/run`); assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.count, 1);
  assert.equal((await T.store.list('incidents', { where: [['connectorId', '==', id]] })).length, 1);
  const runs = (await A('GET', `/api/admin/connectors/${id}/runs?limit=5`)).body.runs; assert.equal(runs.length, 1); assert.equal((await T.store.get('connectors', id)).lastRun.ok, true);
  const patched = await A('PATCH', `/api/admin/connectors/${id}`, { enabled: true, intervalMin: 15 }); assert.equal(patched.body.enabled, true);
  assert.equal((await A('PATCH', `/api/admin/connectors/${id}`, { intervalMin: 0 })).status, 400);
  const sim = await A('POST', '/api/admin/connectors', { type: 'sim', name: 'Simulator', enabled: true, config: {} }); assert.equal(sim.status, 201);
  assert.equal((await A('DELETE', `/api/admin/connectors/${id}`)).status, 200); assert.equal((await A('POST', `/api/admin/connectors/${id}/run`)).status, 404);
  for (const k of ['connector_create', 'connector_test', 'connector_run', 'connector_update', 'connector_delete']) assert.ok((await kinds()).includes(k), k);
});

test('probes CRUD and observations; api keys: plaintext once, hash never returned, revoke', async () => {
  const h = net.map.hubs, mk = (b) => A('POST', '/api/admin/probes', b);
  assert.equal((await mk({ name: 'x', fromNode: 1, toNode: 1, freeMin: 5 })).status, 400); assert.equal((await mk({ name: 'x', fromNode: 1, toNode: net.nn, freeMin: 5 })).status, 400);
  const p = (await mk({ name: 'CBD to Whitefield', fromNode: h[0].node, toNode: h[1].node, fromLabel: 'CBD', toLabel: 'WF', freeMin: 40 })).body; assert.deepEqual([p.enabled, p.weight], [true, 1]);
  assert.equal((await A('PATCH', `/api/admin/probes/${p.id}`, { enabled: false, weight: 2 })).body.enabled, false);
  await T.store.set('probe_obs', 'o1', { id: 'o1', probeId: p.id, at: T0, minutes: 55, source: 't' }); await T.store.set('probe_obs', 'o2', { id: 'o2', probeId: 'other', at: T0 - 1, minutes: 5, source: 't' });
  assert.equal((await A('GET', `/api/admin/probes/observations?probeId=${p.id}`)).body.observations.length, 1); assert.equal((await A('GET', '/api/admin/probes/observations?limit=1')).body.observations.length, 1);
  assert.equal((await A('DELETE', `/api/admin/probes/${p.id}`)).status, 200); assert.equal((await A('DELETE', `/api/admin/probes/${p.id}`)).status, 404);
  assert.equal((await A('POST', '/api/admin/apikeys', { name: 'k', scopes: ['nope'] })).status, 400); assert.equal((await A('POST', '/api/admin/apikeys', { name: 'k', scopes: [] })).status, 400);
  const k = await A('POST', '/api/admin/apikeys', { name: 'Traffic vendor', scopes: ['events', 'speeds'], rateLimit: 10 }); assert.equal(k.status, 201); assert.match(k.body.key, /^blr_/); assert.equal(k.body.apikey.hash, undefined);
  const list = await A('GET', '/api/admin/apikeys'); assert.ok(!list.text.includes(k.body.key)); assert.ok(!list.text.includes('"hash"')); assert.equal(list.body.apikeys[0].prefix, k.body.key.slice(0, 12));
  assert.equal((await A('DELETE', `/api/admin/apikeys/${k.body.apikey.id}`)).body.revoked, true);
  assert.equal((await T.app.inject({ method: 'POST', url: '/ingest/v1/speeds', headers: { 'x-api-key': k.body.key }, payload: { observations: [] } })).statusCode, 401, 'revoked key rejected');
});

test('CSV imports: dry run writes nothing, real run writes, rows rejected with reasons, bad bodies refused', async () => {
  const st = net.map.st[1].n, road = net.map.n[1], csv = { 'content-type': 'text/csv' };
  const works = `name,road,station,from,to,hours,cap,kind,agency\nFlyover,${road},${st},2026-10-07,2026-11-01,all,0.5,flyover,BBMP\nBad,${road},Atlantis,2026-10-07,2026-11-01,all,0.5,x,\n`;
  const d = await A('POST', '/api/admin/import/works?dryRun=1', works, csv); assert.deepEqual([d.status, d.body.accepted, d.body.dryRun, d.body.rejected.length], [200, 1, true, 1]); assert.equal(d.body.rejected[0].row, 3); assert.match(d.body.rejected[0].reason, /Atlantis/);
  assert.equal((await T.store.list('works')).length, 0);
  assert.equal((await A('POST', '/api/admin/import/works', works, csv)).body.accepted, 1); assert.equal((await A('POST', '/api/admin/import/works', works, csv)).body.accepted, 1);
  const w = await T.store.list('works'); assert.equal(w.length, 1, 're-import is idempotent'); assert.equal(w[0].source, 'csv');
  const crash = `station,year,fatal,nonfatal\n${st},2025,7,70\n${st},2024,1,2\nNowhere,2025,1,1\n`;
  assert.equal((await A('POST', '/api/admin/import/crash?dryRun=1', crash, csv)).body.accepted, 2); assert.equal(await T.store.get('crash_stats', st), null);
  const r = await A('POST', '/api/admin/import/crash', crash, csv); assert.equal(r.body.accepted, 2); assert.equal(r.body.rejected.length, 1);
  const cs = (await T.call('viewer', 'GET', '/api/crash')).body; assert.deepEqual(cs.stations[st].y2025, { fatal: 7, nonfatal: 70 }); assert.deepEqual(cs.stations[st].hist['2024'], [1, 2]); assert.equal(cs.importedAt, T0);
  assert.equal((await A('POST', '/api/admin/import/crash', 'wrong,header\n1,2', csv)).status, 400); assert.equal((await A('POST', '/api/admin/import/crash', { a: 1 })).status, 400); assert.equal((await A('POST', '/api/admin/import/crash', '', csv)).status, 400);
  assert.ok((await A('GET', '/api/admin/stations')).body.stations.find((x) => x.name === st).crash.imported);
});

test('exports and audit log: filters, CSV, formula-injection safe; checks run; AI usage and limits', async () => {
  const ex = await A('GET', '/api/admin/export/actions.csv?from=2026-10-07&to=2026-10-07'); assert.equal(ex.status, 200); assert.match(ex.headers['content-type'], /text\/csv/); assert.match(ex.text.split('\n')[0], /^id,date,type,station/); assert.ok(ex.text.split('\n').length > 5);
  assert.equal((await A('GET', '/api/admin/export/actions.csv?from=oops')).status, 400); assert.equal((await A('GET', '/api/admin/export/actions.csv?from=2030-01-01')).text.trim().split('\n').length, 1);
  await T.store.set('audit', 'evil', { id: 'evil', at: T0 + 5, actor: 'x@y.z', role: 'admin', kind: 'test', target: '', summary: '=cmd|calc' });
  const au = await A('GET', '/api/admin/audit?kind=user_create&limit=5'); assert.ok(au.body.audit.length >= 1 && au.body.audit.every((a) => a.kind === 'user_create'));
  assert.ok((await A('GET', `/api/admin/audit?actor=${em('admin')}`)).body.audit.every((a) => a.actor === em('admin')));
  const page1 = (await A('GET', '/api/admin/audit?limit=2')).body; const page2 = (await A('GET', `/api/admin/audit?limit=2&before=${page1.next}`)).body; assert.ok(page2.audit.every((a) => a.at < page1.next));
  assert.equal((await A('GET', '/api/admin/audit?from=abc')).status, 400);
  const csv = await A('GET', '/api/admin/audit.csv?kind=test'); assert.ok(csv.text.includes("\"'=cmd|calc\"") || csv.text.includes("'=cmd|calc"));
  const none = await A('GET', '/api/admin/checks'); assert.equal(none.body.at, null);
  const run = await A('POST', '/api/admin/checks/run'); assert.equal(run.status, 200); const ids = run.body.results.map((r) => r.id); for (const id of ['store', 'auth', 'feed', 'scheduler', 'tick_duration', 'connectors', 'ai', 'map', 'clock']) assert.ok(ids.includes(id), id);
  assert.equal(run.body.results.find((r) => r.id === 'store').status, 'ok'); assert.equal((await A('GET', '/api/admin/checks')).body.at, T0);
  await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'city' });
  const u = (await A('GET', '/api/admin/ai/usage?days=7')).body; assert.equal(u.days.length, 1); assert.equal(u.totals.calls, 1); assert.ok(u.totals.estCostUsd > 0); assert.match(u.note, /estimates/); assert.equal((await A('GET', '/api/admin/ai/usage?days=0')).status, 400);
  assert.equal((await A('PUT', '/api/admin/ai/limits', { dailyCallCap: 7, perUserDaily: { station: 2 } })).body.ai.dailyCallCap, 7); assert.equal((await A('PUT', '/api/admin/ai/limits', { dailyCallCap: -1 })).status, 400); assert.equal((await A('PUT', '/api/admin/ai/limits', { enabled: false })).status, 400, 'only limit keys allowed here');
  assert.equal((await A('GET', '/api/admin/settings')).body.settings.ai.perUserDaily.station, 2);
});
