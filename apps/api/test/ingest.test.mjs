import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApiKey, nodeLatLon } from '@blr/core';
import { makeApp, net, T0 } from './helpers.mjs';

let T, keys = {};
before(async () => {
  T = await makeApp({ tick: false });
  for (const [n, scopes, rl] of [['all', ['events', 'speeds', 'works'], 100], ['events', ['events'], 100], ['tiny', ['events'], 2]]) keys[n] = (await createApiKey(T.store, { name: n, scopes, rateLimit: rl, createdBy: 't', now: T0 })).key;
});
after(() => T.app.close());
const post = (key, path, payload) => T.app.inject({ method: 'POST', url: `/ingest/v1/${path}`, headers: key ? { 'x-api-key': key } : {}, payload }).then((r) => ({ status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }));

test('ingest requires a valid key with the right scope; session credentials do not work here', async () => {
  assert.equal((await post(null, 'events', { events: [] })).status, 401);
  assert.equal((await post('blr_' + 'x'.repeat(43), 'events', { events: [] })).status, 401);
  assert.equal((await post(keys.events, 'speeds', { observations: [] })).status, 403);
  assert.equal((await post(keys.events, 'works', { works: [] })).status, 403);
  assert.equal((await post(keys.events, 'events', { events: [] })).status, 200);
  const dev = await T.app.inject({ method: 'POST', url: '/ingest/v1/events', headers: { 'x-dev-user': 'admin@example.test' }, payload: { events: [] } }); assert.equal(dev.statusCode, 401);
  const apiWithKey = await T.app.inject({ method: 'GET', url: '/api/me', headers: { 'x-api-key': keys.all } }); assert.equal(apiWithKey.statusCode, 401, 'API keys are not accepted on /api');
});

test('events: idempotent on externalId, snap or reject, batch limits', async () => {
  const on = nodeLatLon(net, net.a[900]);
  const ev = { externalId: 'EV-1', type: 'Procession', lat: on.lat, lon: on.lon, durationMin: 45 };
  const r1 = await post(keys.all, 'events', { events: [ev, { externalId: 'EV-2', type: 'x', lat: 0, lon: 0, durationMin: 20 }, { externalId: 'EV-3', type: 'x', edge: 12, durationMin: 20, cap: 0.3 }] });
  assert.equal(r1.status, 200); assert.deepEqual([r1.body.accepted, r1.body.created, r1.body.rejected.length, r1.body.rejected[0].index], [2, 2, 1, 1]);
  const r2 = await post(keys.all, 'events', { events: [ev] }); assert.deepEqual([r2.body.created, r2.body.updated], [0, 1]);
  const docs = await T.store.list('incidents'); assert.equal(docs.length, 2); assert.ok(docs.every((d) => d.src === 'ingest' && d.by.startsWith('key:blr_')));
  assert.equal((await post(keys.all, 'events', { events: 'nope' })).status, 400); assert.equal((await post(keys.all, 'events', { events: [], extra: 1 })).status, 400);
  assert.equal((await post(keys.all, 'events', { events: Array.from({ length: 501 }, (_, i) => ({ externalId: `E${i}` })) })).status, 400);
  assert.equal((await post(keys.all, 'events', { events: [null, 5, 'x'] })).body.rejected.length, 3);
});

test('speeds and works ingestion validate rows and report rejections', async () => {
  await T.store.set('probes', 'p1', { id: 'p1', name: 'P', enabled: true });
  const s = await post(keys.all, 'speeds', { observations: [{ probeId: 'p1', minutes: 30 }, { probeId: 'p1', minutes: 31, at: T0 - 60000 }, { probeId: 'zz', minutes: 3 }, { probeId: 'p1', minutes: 'x' }] });
  assert.equal(s.body.accepted, 2); assert.deepEqual(s.body.rejected.map((r) => r.index), [2, 3]); assert.equal((await T.store.list('probe_obs')).length, 2);
  const w = await post(keys.all, 'works', { works: [{ name: 'Cable laying', road: net.map.n[0], station: net.map.st[0].n, from: '2026-10-07', to: '2026-10-09', cap: 0.7 }, { name: 'bad' }] });
  assert.deepEqual([w.body.accepted, w.body.rejected.length], [1, 1]); assert.equal((await T.store.list('works'))[0].source, 'ingest');
});

test('per-key rate limit returns 429 with Retry-After; other keys are unaffected', async () => {
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await post(keys.tiny, 'events', { events: [] })).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
  const r = await T.app.inject({ method: 'POST', url: '/ingest/v1/events', headers: { 'x-api-key': keys.tiny }, payload: { events: [] } }); assert.ok(r.headers['retry-after']);
  assert.equal((await post(keys.events, 'events', { events: [] })).status, 200);
  const big = await T.app.inject({ method: 'POST', url: '/ingest/v1/events', headers: { 'x-api-key': keys.all, 'content-type': 'application/json' }, payload: JSON.stringify({ events: [{ externalId: 'x'.repeat(300000) }] }) }); assert.equal(big.statusCode, 413);
});
