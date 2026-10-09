import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, fixedClock, getNet, getSettings, createAiRouter } from '@blr/core';
import { buildWorker } from '../src/server.mjs';

const net = getNet(), T0 = Date.parse('2026-10-07T03:30:00Z'), SA = 'scheduler@proj.iam.gserviceaccount.com';
const verifier = async (t) => { if (t === 'sa') return { email: SA, email_verified: true }; if (t === 'other') return { email: 'evil@x.test', email_verified: true }; throw new Error('bad token'); };
let W, store, clock;
before(async () => {
  store = createMemoryStore(); clock = fixedClock(T0);
  W = await buildWorker({ store, clock, net, verifier, logger: false, env: { NODE_ENV: 'test', INTERNAL_INVOKER_SA: SA, BOOTSTRAP_ADMIN_EMAILS: 'a@b.c' }, fetch: async () => new Response('', { status: 500 }) });
});
after(() => W.close());
const call = (path, { token = 'sa', body, method = 'POST' } = {}) => W.inject({ method, url: path, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}, payload: body === undefined ? undefined : JSON.stringify(body) }).then((r) => ({ status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined }));

test('health and readiness are public; /internal/* needs the invoker service account OIDC token', async () => {
  assert.equal((await call('/healthz', { method: 'GET', token: null })).status, 200); assert.equal((await call('/readyz', { method: 'GET', token: null })).body.store, 'ok');
  for (const p of ['tick', 'checks', 'budget', 'retention']) {
    assert.equal((await call(`/internal/${p}`, { token: null })).status, 401, `${p} anon`);
    assert.equal((await call(`/internal/${p}`, { token: 'garbage' })).status, 401, `${p} bad token`);
    assert.equal((await call(`/internal/${p}`, { token: 'other' })).status, 403, `${p} wrong SA`);
  }
  const noSa = await buildWorker({ store, clock, net, verifier, logger: false, env: { NODE_ENV: 'test' } });
  assert.equal((await noSa.inject({ method: 'POST', url: '/internal/retention', headers: { authorization: 'Bearer sa' } })).statusCode, 403, 'no INTERNAL_INVOKER_SA configured: deny all'); await noSa.close();
  await assert.rejects(buildWorker({ store, logger: false, env: { NODE_ENV: 'production', AUTH_MODE: 'dev' } }), /AUTH_MODE=dev/);
});

test('/internal/tick computes state and actions; /internal/checks writes checks/latest; /internal/retention prunes expired docs', async () => {
  const t = await call('/internal/tick'); assert.equal(t.status, 200); assert.equal(t.body.ok, true); assert.ok(t.body.created > 0);
  const st = await store.get('state', 'current'); assert.equal(st.updatedAt, T0); assert.equal((await store.get('state', 'meta')).tickMs > 0, true);
  const c = await call('/internal/checks'); assert.equal(c.status, 200); assert.ok(c.body.results.length >= 8); assert.equal((await store.get('checks', 'latest')).at, T0);
  assert.equal(c.body.results.find((r) => r.id === 'feed').status, 'ok'); assert.equal(c.body.results.find((r) => r.id === 'store').status, 'ok');
  await store.set('state_hist', 'old', { id: 'old', expireAt: T0 - 1 });
  const r = await call('/internal/retention'); assert.equal(r.body.deleted.state_hist, 1); assert.ok(await store.get('state_hist', '202610070900'));
  clock.advance(40 * 60000); assert.equal((await call('/internal/checks')).body.results.find((x) => x.id === 'feed').status, 'fail', 'stale feed is reported');
});

test('/internal/budget: below budget does nothing; at budget turns AI off, disables paid connectors, audits; AI router then refuses', async () => {
  await store.set('connectors', 'gr', { id: 'gr', name: 'Routes', type: 'google_routes', enabled: true, intervalMin: 10, mode: 'live', config: {}, secretRef: 's' });
  await store.set('connectors', 'rs', { id: 'rs', name: 'Rest', type: 'rest', enabled: true, intervalMin: 10, mode: 'live', config: {} });
  const envelope = (cost, budget) => ({ message: { data: Buffer.from(JSON.stringify({ costAmount: cost, budgetAmount: budget, budgetDisplayName: 'b' })).toString('base64'), messageId: '1' }, subscription: 's' });
  const low = await call('/internal/budget', { body: envelope(40, 100) }); assert.deepEqual([low.status, low.body.killed], [200, false]);
  assert.equal((await getSettings(store)).ai.enabled, true);
  assert.equal((await call('/internal/budget', { body: { message: { data: 'bm90IGpzb24=' } } })).status, 400); assert.equal((await call('/internal/budget', { body: {} })).status, 400);
  const hit = await call('/internal/budget', { body: envelope(100, 100) }); assert.deepEqual([hit.status, hit.body.killed, hit.body.disabledConnectors], [200, true, ['gr']]);
  const s = await getSettings(store); assert.equal(s.ai.enabled, false); assert.match(s.ai.killReason, /Budget exceeded/);
  assert.equal((await store.get('connectors', 'gr')).enabled, false); assert.equal((await store.get('connectors', 'rs')).enabled, true);
  const audit = await store.list('audit', { where: [['kind', '==', 'budget_kill']] }); assert.equal(audit.length, 1); assert.equal(audit[0].actor, 'system');
  let generated = 0; const ai = createAiRouter({ store, clock, generate: async () => { generated++; return 'x'; } });
  await assert.rejects(ai.advise({ user: { email: 'u@x', role: 'admin', active: true }, kind: 'translate_kn', context: { text: 'hello' } }), { code: 'unavailable' });
  await assert.rejects(ai.brief({ user: { email: 'u@x', role: 'admin', active: true }, scope: 'city', context: {} }), { code: 'unavailable' }); assert.equal(generated, 0);
  const again = await call('/internal/budget', { body: envelope(120, 100) }); assert.equal(again.body.killed, true); assert.equal((await store.list('audit', { where: [['kind', '==', 'budget_kill']] })).length, 2, 'each over-budget notification is audited');
});

test('a tick runs due connectors (circuit breaker applies); concurrent ticks are not double-run', async () => {
  const s2 = createMemoryStore(), c2 = fixedClock(T0);
  const w = await buildWorker({ store: s2, clock: c2, net, verifier, logger: false, env: { NODE_ENV: 'test', INTERNAL_INVOKER_SA: SA }, resolve: async () => ['93.184.216.34'], fetch: async () => new Response('{}', { status: 500 }) });
  await s2.set('connectors', 'r', { id: 'r', name: 'Flaky', type: 'rest', enabled: true, intervalMin: 1, mode: 'live', createdAt: 1, createdBy: 't', config: { url: 'https://feed.example.org/', target: 'incidents', map: { externalId: '$.id', type: '$.t', edge: '$.e', durationMin: '$.d' } } });
  const hdr = { authorization: 'Bearer sa' };
  const [a, b] = await Promise.all([w.inject({ method: 'POST', url: '/internal/tick', headers: hdr }), w.inject({ method: 'POST', url: '/internal/tick', headers: hdr })]);
  const bodies = [JSON.parse(a.body), JSON.parse(b.body)]; assert.equal(bodies.filter((x) => x.skipped).length, 1);
  const ran = bodies.find((x) => !x.skipped); assert.equal(ran.connectors.length, 1); assert.equal(ran.connectors[0].ok, false);
  for (const m of [2, 4]) { c2.set(T0 + m * 120000); await w.inject({ method: 'POST', url: '/internal/tick', headers: hdr }); }
  const conn = await s2.get('connectors', 'r'); assert.deepEqual([conn.enabled, conn.failures], [false, 3]);
  await w.close();
});

test('idle mode: no recent activity slows ticks to idleTickMin and skips paid connectors; activity resumes normal ticks', async () => {
  const s = createMemoryStore(), c = fixedClock(T0);
  const w = await buildWorker({ store: s, clock: c, net, verifier, logger: false, env: { NODE_ENV: 'test', INTERNAL_INVOKER_SA: SA }, fetch: async () => new Response('', { status: 500 }) });
  const tick = async () => (await w.inject({ method: 'POST', url: '/internal/tick', headers: { authorization: 'Bearer sa' } })).json();
  await s.set('connectors', 'gr', { id: 'gr', name: 'Routes', type: 'google_routes', enabled: true, intervalMin: 1, mode: 'live', config: {}, secretRef: 's' });
  assert.equal((await tick()).idle, false, 'no activity recorded yet: treated as active');
  await s.set('state', 'activity', { id: 'activity', lastSeenAt: T0 });
  c.advance(10 * 60000); assert.equal((await tick()).idle, false, 'activity 10 min ago, idleAfterMin 120');
  c.advance(130 * 60000); const t1 = await tick(); assert.equal(t1.idle, true); assert.equal(t1.skipped, undefined, 'idle but last tick is old enough: runs once');
  assert.equal(t1.connectors.some((x) => x.id === 'gr'), false, 'paid connector skipped while idle'); assert.equal((await s.get('state', 'meta')).idle, true);
  c.advance(10 * 60000); assert.deepEqual(await tick(), { ok: true, skipped: 'idle', idle: true }, 'next 10-min tick is skipped while idle');
  c.advance(55 * 60000); assert.equal((await tick()).skipped, undefined, 'one tick per idleTickMin');
  await s.set('state', 'activity', { id: 'activity', lastSeenAt: c.now() }); c.advance(10 * 60000);
  const t2 = await tick(); assert.equal(t2.idle, false); assert.equal((await s.get('state', 'meta')).idle, false, 'back to normal ticks after activity');
  await w.close();
});
