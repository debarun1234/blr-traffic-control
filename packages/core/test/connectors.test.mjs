import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeLatLon, createConnectorRunner, validateConnector, isBlockedIp, assertSafeUrl, createSafeFetch, jsonPath, defaultSettings } from '../src/index.mjs';
import { net, mk } from './helpers.mjs';

const resolve = async () => ['93.184.216.34'];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function setup(handler, extra = {}) {
  const { store, clock } = mk(); const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  const runner = createConnectorRunner({ store, net, clock, fetch, resolve, production: true, secretReader: async (ref) => (ref === 'missing' ? '' : 'S3CRET-VALUE-123'), ...extra });
  return { store, clock, calls, runner };
}
const conn = (o) => ({ id: 'c1', name: 'C1', type: 'rest', enabled: true, intervalMin: 5, mode: 'live', config: {}, createdBy: 't', createdAt: 1, ...o });
const restCfg = { url: 'https://feed.example.org/inc', target: 'incidents', itemsPath: '$.data.items', map: { externalId: '$.id', type: '$.kind', lat: '$.pos.lat', lon: '$.pos.lon', durationMin: '$.mins' } };

test('SSRF: private, loopback, link-local, metadata and mapped addresses are blocked; scheme and credentials checked', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:a00:1']) assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isBlockedIp(ip), false, ip);
  await assert.rejects(assertSafeUrl('http://example.org/x', { production: true, resolve }), /https/);
  await assert.doesNotReject(assertSafeUrl('http://example.org/x', { production: false, resolve }));
  await assert.rejects(assertSafeUrl('https://example.org/', { production: true, resolve: async () => ['10.0.0.5'] }), /private/);
  await assert.rejects(assertSafeUrl('https://a.example.org/', { production: true, resolve: async () => ['93.184.216.34', '169.254.169.254'] }), /private/);
  await assert.rejects(assertSafeUrl('https://169.254.169.254/computeMetadata/v1/', { production: true, resolve }), /private/);
  await assert.rejects(assertSafeUrl('https://metadata.google.internal/', { production: true, resolve }), /not allowed/);
  await assert.rejects(assertSafeUrl('https://u:p@example.org/', { production: true, resolve }), /Credentials/);
  await assert.rejects(assertSafeUrl('file:///etc/passwd', { production: false, resolve }));
  const sf = createSafeFetch({ fetch: async () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } }), resolve, production: true });
  await assert.rejects(sf('https://example.org/'), /Redirects/);
  const big = createSafeFetch({ fetch: async () => new Response('x'.repeat(5000)), resolve, production: true, maxBytes: 1000 });
  await assert.rejects(big('https://example.org/'), /exceeds/);
});

test('jsonpath-lite: keys, indexes, wildcards, forbidden keys', () => {
  const o = { a: { b: [{ c: 1 }, { c: 2 }] } };
  assert.deepEqual(jsonPath(o, '$.a.b[*].c'), [1, 2]); assert.deepEqual(jsonPath(o, '$.a.b[1].c'), [2]); assert.deepEqual(jsonPath(o, "$['a'].b[0]"), [{ c: 1 }]);
  assert.deepEqual(jsonPath(o, '$.zzz.c'), []); assert.throws(() => jsonPath(o, '$.__proto__.x')); assert.throws(() => jsonPath(o, 'a.b'));
});

test('connector validation: type/config checks, secrets must not live in config, paid types need secretRef', () => {
  const ok = conn({ config: restCfg });
  assert.deepEqual(validateConnector(ok), []);
  assert.ok(validateConnector({ ...ok, type: 'nope' })[0].includes('type'));
  assert.ok(validateConnector({ ...ok, config: { ...restCfg, apiKey: 'abc' } }).some((e) => /secretRef/.test(e)));
  assert.ok(validateConnector({ ...ok, config: { ...restCfg, headers: { Authorization: 'x' } } }).some((e) => /headers/.test(e)));
  assert.ok(validateConnector({ ...ok, config: { ...restCfg, map: { id: '$.x' } } }).length > 0);
  assert.ok(validateConnector({ ...ok, type: 'google_routes', config: {} }).some((e) => /secretRef/.test(e)));
  assert.deepEqual(validateConnector({ ...ok, type: 'google_routes', config: {}, secretRef: 'routes-key' }), []);
  assert.deepEqual(validateConnector({ ...ok, type: 'sim', config: {} }), []);
});

test('rest connector: maps JSON to incidents (lat/lon snapped), rejects bad rows, idempotent, honours interval, test() never writes', async () => {
  const mid = (e) => { const A = net.map.nxy[net.a[e]], B = net.map.nxy[net.b[e]]; return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; };
  let e = 0; while (net.name[e] < 0 || net.len[e] < 60) e++;
  const [mx, my] = mid(e), lat = net.map.o[1] + (my * 2.2) / 111320, lon = net.map.o[0] + (mx * 2.2) / (111320 * Math.cos((lat * Math.PI) / 180));
  const body = { data: { items: [{ id: 'X1', kind: 'Accident', pos: { lat, lon }, mins: 40 }, { id: 'X2', kind: 'Accident', pos: { lat: 0, lon: 0 }, mins: 40 }] } };
  const { store, clock, calls, runner } = setup(() => json(body));
  await store.set('connectors', 'c1', conn({ config: restCfg }));
  const t = await runner.test(await store.get('connectors', 'c1'));
  assert.equal(t.ok, true); assert.equal(t.count, 1); assert.equal(t.rejected.length, 1);
  assert.equal((await store.list('incidents')).length, 0, 'test() is a dry run');
  const r1 = await runner.runDue({ now: clock.now() });
  assert.equal(r1.length, 1); assert.equal(r1[0].count, 1);
  const inc = await store.list('incidents'); assert.equal(inc.length, 1);
  assert.equal(inc[0].src, 'connector'); assert.equal(inc[0].connectorId, 'c1'); assert.equal(inc[0].edge, e); assert.equal(inc[0].id, 'c-c1-X1');
  assert.equal((await runner.runDue({ now: clock.now() + 60000 })).length, 0, 'interval not elapsed');
  await runner.runDue({ now: clock.now() + 6 * 60000 });
  assert.equal((await store.list('incidents')).length, 1, 'idempotent on externalId');
  const c = await store.get('connectors', 'c1'); assert.equal(c.lastRun.ok, true);
  assert.equal((await store.list('connector_runs')).length, 2); assert.ok((await store.list('connector_runs'))[0].expireAt > clock.now());
  assert.ok(calls.length >= 3);
});

test('shadow mode records runs but does not write data', async () => {
  const p = nodeLatLon(net, net.a[100]);
  const { store, clock, runner } = setup(() => json({ data: { items: [{ id: 'S1', kind: 'Accident', pos: { lat: p.lat, lon: p.lon }, mins: 30 }] } }));
  await store.set('connectors', 'c1', conn({ mode: 'shadow', config: restCfg }));
  const [r] = await runner.runDue({ now: clock.now() });
  assert.equal(r.ok, true); assert.equal((await store.list('incidents')).length, 0);
});

test('circuit breaker: 3 consecutive failures auto-disable the connector and audit it', async () => {
  const { store, clock, runner } = setup(() => json({}, 500));
  await store.set('connectors', 'c1', conn({ intervalMin: 1, config: restCfg }));
  for (let i = 0; i < 3; i++) await runner.runDue({ now: clock.now() + i * 120000 });
  const c = await store.get('connectors', 'c1');
  assert.equal(c.enabled, false); assert.equal(c.failures, 3); assert.match(c.disabledReason, /circuit breaker/); assert.equal(c.lastRun.ok, false);
  assert.equal((await store.list('audit', { where: [['kind', '==', 'connector_autodisable']] })).length, 1);
  assert.equal((await runner.runDue({ now: clock.now() + 9e6 })).length, 0, 'disabled connectors are not run');
});

test('response size cap and non-JSON bodies fail the run without writing', async () => {
  const { store, clock, runner } = setup(() => new Response('y'.repeat(3000)));
  await store.set('connectors', 'c1', conn({ config: { ...restCfg, maxBytes: 1000 } }));
  const [r] = await runner.runDue({ now: clock.now() }); assert.equal(r.ok, false); assert.match(r.error, /exceeds/);
});

test('google_routes: reads secret via secretRef, uses traffic-aware duration, enforces the per-day cap, never leaks the secret', async () => {
  const seen = [];
  const { store, clock, runner } = setup((url, init) => { seen.push({ url, init }); return json({ routes: [{ duration: '1200s', staticDuration: '600s' }] }); });
  const s = { ...defaultSettings(), caps: { routesCallsPerDay: 2, tomtomCallsPerDay: 5 } }; await store.set('settings', 'app', s);
  const h = net.map.hubs;
  for (let i = 0; i < 3; i++) await store.set('probes', `p${i}`, { id: `p${i}`, name: `P${i}`, fromNode: h[0].node, toNode: h[i + 1].node, fromLabel: 'a', toLabel: 'b', freeMin: 10, enabled: true, weight: 1 });
  await store.set('probes', 'off', { id: 'off', name: 'off', fromNode: h[0].node, toNode: h[1].node, fromLabel: 'a', toLabel: 'b', freeMin: 10, enabled: false, weight: 1 });
  await store.set('connectors', 'g', conn({ id: 'g', type: 'google_routes', secretRef: 'routes-key', config: {} }));
  const [r] = await runner.runDue({ now: clock.now() });
  assert.equal(r.ok, true); assert.equal(r.count, 2, 'cap of 2 calls stops the third probe');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'S3CRET-VALUE-123');
  const body = JSON.parse(seen[0].init.body); assert.equal(body.routingPreference, 'TRAFFIC_AWARE'); assert.ok(body.origin.location.latLng.latitude > 12 && body.origin.location.latLng.latitude < 14);
  const obs = await store.list('probe_obs'); assert.equal(obs.length, 2); assert.equal(obs[0].minutes, 20); assert.ok(obs[0].expireAt > clock.now());
  assert.equal((await store.get('counters', [...(await store.list('counters'))].find((c) => c.name === 'routes').id)).calls, 2);
  const [r2] = await runner.runDue({ now: clock.now() + 600000 });
  assert.equal(r2.ok, false); assert.match(r2.error, /cap/); assert.equal(seen.length, 2, 'no call once the cap is reached');
  const dump = JSON.stringify([await store.list('connector_runs'), await store.list('connectors'), await store.list('audit')]);
  assert.ok(!dump.includes('S3CRET'), 'secret never persisted');
});

test('tomtom: key in query is redacted from errors; failed secret read fails cleanly', async () => {
  const { store, clock, runner } = setup(() => { throw new Error('boom key=S3CRET-VALUE-123 S3CRET-VALUE-123'); });
  const h = net.map.hubs; await store.set('probes', 'p', { id: 'p', name: 'P', fromNode: h[0].node, toNode: h[1].node, fromLabel: 'a', toLabel: 'b', freeMin: 10, enabled: true, weight: 1 });
  await store.set('connectors', 't', conn({ id: 't', type: 'tomtom', secretRef: 'tt', config: {} }));
  await store.set('connectors', 'm', conn({ id: 'm', type: 'tomtom', secretRef: 'missing', config: {} }));
  await runner.runDue({ now: clock.now() });
  const runs = await store.list('connector_runs'); assert.equal(runs.length, 2); assert.ok(runs.every((r) => !r.ok));
  assert.ok(!JSON.stringify(runs).includes('S3CRET'));
});

test('connector dailyCap limits outbound calls per day', async () => {
  const { store, clock, runner } = setup(() => json({ data: { items: [] } }));
  await store.set('connectors', 'c1', conn({ intervalMin: 1, dailyCap: 2, config: restCfg }));
  const out = []; for (let i = 0; i < 3; i++) out.push((await runner.runDue({ now: clock.now() + i * 120000 }))[0]);
  assert.deepEqual(out.map((o) => o.ok), [true, true, false]); assert.match(out[2].error, /daily cap/);
});

test('gba_works and csv connectors validate rows with the importer rules; opencity_crash updates crash_stats', async () => {
  const stn = net.map.st[0].n, road = net.map.n[0];
  const csv = `Name,Road,Station,From,To,Hours,Cap,Kind\nMetro dig,${road},${stn},2026-10-01,2026-12-01,peak,0.6,metro\nBad,${road},Nowhere,2026-10-01,2026-12-01,all,0.5,x\nBad cap,${road},${stn},2026-10-01,2026-12-01,all,7,x\n`;
  const crash = `station,year,fatal,nonfatal\n${stn},2025,3,40\n${stn},2025,9,9\n${stn},1999,1,1\n`;
  const { store, clock, runner } = setup((url) => new Response(url.includes('crash') ? crash : csv));
  await store.set('connectors', 'g', conn({ id: 'g', type: 'gba_works', config: { url: 'https://data.example.org/works.csv' } }));
  await store.set('connectors', 'o', conn({ id: 'o', type: 'opencity_crash', config: { url: 'https://data.example.org/crash.csv' } }));
  const res = await runner.runDue({ now: clock.now() });
  assert.deepEqual(res.map((r) => [r.id, r.ok, r.count]).sort(), [['g', true, 1], ['o', true, 1]]);
  const [w] = await store.list('works'); assert.equal(w.source, 'connector'); assert.equal(w.name, 'Metro dig'); assert.equal(w.hours, 'peak'); assert.equal(w.active, true);
  const c = await store.get('crash_stats', stn); assert.deepEqual(c.y2025, { fatal: 3, nonfatal: 40 }); assert.deepEqual(c.hist['2025'], [3, 40]);
});

test('sim and webhook connectors are inert markers', async () => {
  const { store, clock, runner, calls } = setup(() => json({}));
  await store.set('connectors', 's', conn({ id: 's', type: 'sim', config: {} }));
  assert.equal((await runner.runDue({ now: clock.now() })).length, 0); assert.equal(calls.length, 0);
  assert.equal((await runner.test(await store.get('connectors', 's'))).ok, true);
});
