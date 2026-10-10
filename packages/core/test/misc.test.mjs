import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createAuthenticator, assertAuthConfig, defaultSettings, getSettings, putSettings, validateSettings, createAudit,
  parseCsv, importWorksCsv, importCrashCsv, toCsv, createApiKey, lookupKey, authIngest, createRateLimiter, ingestEvents, ingestSpeeds, ingestWorks,
  runRetention, runChecks, applyBudget, parseBudgetMessage, snapToEdge, nodeLatLon, fixedClock, istDay } from '../src/index.mjs';
import { net, mk, T0 } from './helpers.mjs';

test('AUTH_MODE=dev is refused in production, allowed otherwise', () => {
  assert.throws(() => assertAuthConfig({ AUTH_MODE: 'dev', NODE_ENV: 'production' }), /forbidden/);
  assert.throws(() => createAuthenticator({ store: createMemoryStore(), clock: fixedClock(1), env: { AUTH_MODE: 'dev', NODE_ENV: 'production' } }));
  assert.doesNotThrow(() => assertAuthConfig({ AUTH_MODE: 'dev', NODE_ENV: 'test' }));
});

test('auth: allowlist, inactive, bearer verifier, bootstrap admin, uid/lastLogin on first call, 60 s cache', async () => {
  const { store, clock } = mk();
  await store.set('users', 'a@x.test', { email: 'a@x.test', role: 'station', station: 'Yelahanka', active: true, createdBy: 't', createdAt: 1 });
  await store.set('users', 'off@x.test', { email: 'off@x.test', role: 'admin', active: false, createdBy: 't', createdAt: 1 });
  const verifier = async (t) => { if (t === 'good') return { email: 'A@X.test', uid: 'u1', email_verified: true }; if (t === 'boot') return { email: 'Boss@x.test', uid: 'u2', email_verified: true, name: 'Boss' }; if (t === 'unverified') return { email: 'a@x.test', email_verified: false }; throw new Error('bad'); };
  const a = createAuthenticator({ store, clock, verifier, env: { AUTH_MODE: 'dev', BOOTSTRAP_ADMIN_EMAILS: 'boss@x.test, other@x.test' } });
  const code = async (h) => (await a.verifyRequest(h).then(() => 'ok', (e) => e.status));
  assert.equal(await code({}), 401); assert.equal(await code({ authorization: 'Bearer nope' }), 401); assert.equal(await code({ authorization: 'Bearer unverified' }), 401);
  assert.equal(await code({ 'x-dev-user': 'ghost@x.test' }), 403); assert.equal(await code({ 'x-dev-user': 'off@x.test' }), 403);
  const u = await a.verifyRequest({ authorization: 'Bearer good' });
  assert.equal(u.email, 'a@x.test'); assert.equal(u.uid, 'u1'); assert.equal(u.lastLogin, clock.now());
  assert.equal((await store.get('users', 'a@x.test')).uid, 'u1');
  const b = await a.verifyRequest({ authorization: 'Bearer boot' });
  assert.equal(b.role, 'admin'); assert.equal((await store.get('users', 'boss@x.test')).createdBy, 'bootstrap');
  // cache: deactivating in the store is only seen after 60 s (or invalidate)
  await store.update('users', 'a@x.test', { active: false });
  assert.equal(await code({ 'x-dev-user': 'a@x.test' }), 'ok'); clock.advance(61000); assert.equal(await code({ 'x-dev-user': 'a@x.test' }), 403);
  // dev header is ignored when AUTH_MODE is not dev
  const prod = createAuthenticator({ store, clock, verifier, env: { NODE_ENV: 'production' } });
  assert.equal(await prod.verifyRequest({ 'x-dev-user': 'off@x.test' }).then(() => 'ok', (e) => e.status), 401);
});

test('settings: defaults, deep merge, unknown keys and bad values rejected, persisted', async () => {
  const store = createMemoryStore();
  assert.deepEqual(validateSettings(defaultSettings()), []);
  assert.ok(validateSettings({ feed: { mode: 'weird' } })[0].includes('feed.mode'));
  assert.ok(validateSettings({ feed: { tickMin: 20, idleTickMin: 10 } }).some((m) => m.includes('idleTickMin')));
  assert.equal(defaultSettings().feed.idleAfterMin, 120); assert.ok(validateSettings({ feed: { idleAfterMin: -1 } }).length);
  const d = defaultSettings(); assert.equal(d.map.defaultView, 'traffic'); assert.equal(d.map.views.safety.viewer, false);
  assert.ok(validateSettings({ ...d, map: { ...d.map, speedBands: { slow: 20, moderate: 20, good: 27, fast: 34 } } }).some((m) => m.includes('speedBands')));
  assert.ok(validateSettings({ ...d, map: { ...d.map, defaultView: 'x' } }).some((m) => m.includes('map.defaultView')));
  assert.ok(validateSettings({ nope: 1 })[0].includes('unknown key')); assert.ok(validateSettings({ ai: { tiers: { t1: { model: 'bad model!' } } } }).length);
  assert.ok(validateSettings({ feed: { tickMin: 0 } }).length); assert.ok(validateSettings({ caps: { routesCallsPerDay: 1.5 } }).length);
  const bad = await putSettings(store, { workflow: { escalateAfterMin: 'x' } }); assert.ok(bad.errors.length); assert.equal(await store.get('settings', 'app'), null);
  const ok = await putSettings(store, { feed: { mode: 'blend' }, ai: { perUserDaily: { station: 5 } } });
  assert.equal(ok.settings.feed.mode, 'blend'); assert.equal(ok.settings.feed.tickMin, 10); assert.equal(ok.settings.ai.perUserDaily.station, 5); assert.equal(ok.settings.ai.perUserDaily.admin, 100);
  assert.equal((await getSettings(store)).feed.mode, 'blend');
  await store.set('settings', 'app', { feed: { mode: 'live', legacyKey: 1 }, junk: 1 });
  const g = await getSettings(store); assert.equal(g.feed.mode, 'live'); assert.ok(!('junk' in g) && !('legacyKey' in g.feed));
});

test('audit rows are appended with sortable ids', async () => {
  const { store, clock } = mk(); const audit = createAudit({ store, clock });
  const r1 = await audit.write({ actor: 'a@x', role: 'admin', kind: 'k', target: 't', summary: 's' }); clock.advance(5); const r2 = await audit.write({ actor: 'a@x', kind: 'k2', summary: 's' });
  assert.ok(r1.id < r2.id); assert.equal((await store.list('audit')).length, 2);
});

test('CSV: strict parsing, quoting, row-level rejection reasons, formula injection neutralised', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","q""r"\n', { required: ['a', 'b'] }).rows[0].data, { a: 'x, y', b: 'q"r' });
  assert.match(parseCsv('a\n1', { required: ['a', 'b'] }).error, /missing columns: b/); assert.match(parseCsv('a,b\n"x', {}).error, /quote/); assert.ok(parseCsv('a\n' + '1\n'.repeat(10), { maxRows: 5 }).error);
  const st = net.map.st[3].n, road = net.map.n[2];
  const w = importWorksCsv(`name,road,station,from,to,hours,cap,kind,agency\nOK,${road},${st},2026-10-01,2026-10-05,all,0.5,roadwork,BBMP\n,${road},${st},2026-10-01,2026-10-05,all,0.5,x,\nX,${road},Atlantis,2026-10-01,2026-10-05,all,0.5,x,\nX,${road},${st},2026-13-01,2026-10-05,all,0.5,x,\nX,${road},${st},2026-10-09,2026-10-05,all,0.5,x,\nX,${road},${st.toLowerCase()},2026-10-01,2026-10-05,day,0.5,x,\nX,${road},${st},2026-10-01,2026-10-05,all,1.5,x,\n`, net);
  assert.equal(w.accepted.length, 1); assert.deepEqual(w.rejected.map((r) => r.row), [3, 4, 5, 6, 7, 8]);
  assert.match(w.rejected[1].reason, /unknown station/); assert.match(w.rejected[2].reason, /from/); assert.match(w.rejected[3].reason, /before/); assert.match(w.rejected[4].reason, /hours/); assert.match(w.rejected[5].reason, /cap/);
  const c = importCrashCsv(`station,year,fatal,nonfatal\n${st},2025,1,2\n${st},2025,3,4\n${st},2024,-1,2\n${st},1980,1,1\nNope,2025,1,1\n${st},2024,x,1\n`, net);
  assert.equal(c.accepted.length, 1); assert.equal(c.rejected.length, 5); assert.match(c.rejected[0].reason, /duplicate/);
  assert.equal(toCsv(['a'], [{ a: '=HYPERLINK("x")' }, { a: 'x,y' }]), 'a\n"\'=HYPERLINK(""x"")"\n"x,y"\n');
});

test('API keys: blr_ + 32 random bytes, only SHA-256 stored, scopes, revocation, constant-time lookup, rate limit', async () => {
  const { store, clock } = mk();
  const { doc, key } = await createApiKey(store, { name: 'feed', scopes: ['events'], rateLimit: 2, createdBy: 'a', now: clock.now() });
  assert.match(key, /^blr_[A-Za-z0-9_-]{43}$/); assert.equal(doc.prefix, key.slice(0, 12)); assert.equal(doc.hash.length, 64);
  assert.ok(!JSON.stringify(await store.list('apikeys')).includes(key));
  const limiter = createRateLimiter({ clock }), env = { store, limiter, clock };
  assert.equal((await authIngest(env, { 'x-api-key': key }, 'events')).id, doc.id);
  await assert.rejects(authIngest(env, { 'x-api-key': key }, 'works'), { code: 'forbidden' });
  await assert.rejects(authIngest(env, { 'x-api-key': key.slice(0, -1) + 'x' }, 'events'), { code: 'unauthenticated' });
  await assert.rejects(authIngest(env, {}, 'events'), { code: 'unauthenticated' });
  await authIngest(env, { 'x-api-key': key }, 'events');
  await assert.rejects(authIngest(env, { 'x-api-key': key }, 'events'), { code: 'rate_limited' });
  clock.advance(61000); await authIngest(env, { 'x-api-key': key }, 'events');
  await store.update('apikeys', doc.id, { revoked: true }); assert.equal(await lookupKey(store, key), null);
});

test('ingest: events idempotent on externalId, lat/lon snap within 150 m else reject; speeds need known probes; works validated', async () => {
  const { store, clock } = mk(); const key = { id: 'k1', prefix: 'blr_abcdefgh' }, now = clock.now();
  const on = nodeLatLon(net, net.a[500]), far = { lat: on.lat + 0.05, lon: on.lon };
  const ev = [{ externalId: 'E1', type: 'Accident', lat: on.lat, lon: on.lon, durationMin: 30 }, { externalId: 'E2', type: 'Accident', edge: 7, durationMin: 30, cap: 0.2 }, { externalId: 'E3', type: 'Accident', ...far, durationMin: 30 }, { externalId: 'bad id', type: 'x', edge: 1, durationMin: 30 }, { externalId: 'E5', type: 'x', edge: 1, durationMin: 1 }, { externalId: 'E6', type: 'x', edge: 99999999, durationMin: 20 }];
  const r1 = await ingestEvents({ store, net, now }, key, ev);
  assert.equal(r1.accepted, 2); assert.equal(r1.created, 2); assert.deepEqual(r1.rejected.map((r) => r.index), [2, 3, 4, 5]); assert.match(r1.rejected[0].reason, /150 m/);
  const r2 = await ingestEvents({ store, net, now: now + 1000 }, key, ev.slice(0, 2));
  assert.equal(r2.created, 0); assert.equal(r2.updated, 2); assert.equal((await store.list('incidents')).length, 2);
  const i = await store.get('incidents', 'ing-k1-E2'); assert.equal(i.src, 'ingest'); assert.equal(i.cap, 0.2); assert.equal(i.createdAt, now); assert.equal(i.date, '2026-10-07');
  await store.set('probes', 'p1', { id: 'p1', enabled: true });
  const sp = await ingestSpeeds({ store, now }, [{ probeId: 'p1', minutes: 33 }, { probeId: 'p1', minutes: 33 }, { probeId: 'zz', minutes: 5 }, { probeId: 'p1', minutes: -1 }, { probeId: 'p1', minutes: 5, at: now - 3 * 86400000 }]);
  assert.equal(sp.accepted, 2); assert.equal(sp.rejected.length, 3); assert.equal((await store.list('probe_obs')).length, 1, 'same probe+timestamp is idempotent');
  const wk = await ingestWorks({ store, net, now }, key, [{ name: 'W', road: net.map.n[0], station: net.map.st[0].n, from: '2026-10-01', to: '2026-10-02', cap: 0.5 }, { name: '' }]);
  assert.equal(wk.accepted, 1); assert.equal(wk.rejected.length, 1); assert.equal((await store.list('works'))[0].source, 'ingest');
  assert.equal(snapToEdge(net, 0, 0), null);
});

test('retention deletes only expired TTL docs; budget kill disables AI and paid connectors idempotently; checks report the latest shape', async () => {
  const { store, clock } = mk(); const now = clock.now();
  await store.set('state_hist', 'a', { id: 'a', expireAt: now - 1 }); await store.set('state_hist', 'b', { id: 'b', expireAt: now + 1000 });
  await store.set('ai_cache', 'k', { key: 'k', expireAt: now - 5 }); await store.set('probe_obs', 'o', { id: 'o', expireAt: now - 5 }); await store.set('actions', 'x', { id: 'x' }); await store.set('audit', 'au', { id: 'au', expireAt: 1 });
  const r = await runRetention({ store, now });
  assert.deepEqual([r.deleted.state_hist, r.deleted.ai_cache, r.deleted.probe_obs], [1, 1, 1]);
  assert.ok(await store.get('state_hist', 'b')); assert.ok(await store.get('actions', 'x')); assert.ok(await store.get('audit', 'au'), 'audit is never deleted');
  await store.set('connectors', 'g', { id: 'g', type: 'google_routes', enabled: true }); await store.set('connectors', 'r', { id: 'r', type: 'rest', enabled: true });
  assert.equal((await applyBudget({ store, clock }, { costAmount: 50, budgetAmount: 100 })).killed, false);
  const k = await applyBudget({ store, clock }, { costAmount: 100, budgetAmount: 100 });
  assert.equal(k.killed, true); assert.deepEqual(k.disabledConnectors, ['g']);
  assert.equal((await getSettings(store)).ai.enabled, false); assert.equal((await store.get('connectors', 'r')).enabled, true);
  assert.equal((await store.list('audit', { where: [['kind', '==', 'budget_kill']] })).length, 1);
  assert.deepEqual(parseBudgetMessage({ message: { data: Buffer.from(JSON.stringify({ costAmount: 5, budgetAmount: 10 })).toString('base64') } }), { costAmount: 5, budgetAmount: 10 });
  assert.equal(parseBudgetMessage({ message: { data: 'not-base64-json' } }), null); assert.equal(parseBudgetMessage({}), null);
  const c = await runChecks({ store, net, clock, env: { NODE_ENV: 'test', BOOTSTRAP_ADMIN_EMAILS: 'a@b.c' }, timeSource: async () => now + 90000 });
  const by = Object.fromEntries(c.results.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(by).sort(), ['ai', 'auth', 'clock', 'connectors', 'feed', 'map', 'scheduler', 'store', 'tick_duration']);
  assert.equal(by.store.status, 'ok'); assert.equal(by.feed.status, 'fail'); assert.equal(by.clock.status, 'fail'); assert.equal(by.ai.status, 'warn'); assert.equal(by.map.status, 'ok');
  assert.ok(c.results.every((x) => typeof x.ms === 'number' && x.detail !== undefined)); assert.deepEqual(await store.get('checks', 'latest'), c);
});

test('rate limiter: fixed window per key', () => {
  const clock = fixedClock(0), l = createRateLimiter({ clock });
  assert.equal(l.hit('a', 2).ok, true); assert.equal(l.hit('a', 2).ok, true); const r = l.hit('a', 2); assert.equal(r.ok, false); assert.equal(r.retryAfterSec, 60);
  assert.equal(l.hit('b', 2).ok, true); clock.advance(60001); assert.equal(l.hit('a', 2).ok, true);
});
