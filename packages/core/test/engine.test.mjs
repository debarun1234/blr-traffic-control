import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeState } from '@blr/model';
import { runTick, defaultSettings, getSettings, createMemoryStore } from '../src/index.mjs';
import { net, T0, mk } from './helpers.mjs';

const MIN = 60000;
const shared = mk();

test('tick writes state, history and actions; running twice in the same minute does not duplicate', async () => {
  const { store } = shared;
  const r1 = await runTick({ store, net, now: T0 });
  const s = await store.get('state', 'current');
  assert.equal(s.mode, 'sim'); assert.equal(s.date, '2026-10-07'); assert.equal(s.net.edges, net.ne); assert.equal(s.stale, false);
  const d = decodeState({ vc: s.vc, spd: s.spd, n: net.ne });
  assert.equal(d.vc.length, net.ne); assert.ok(d.spd.some((x) => x > 0));
  assert.equal(s.stations.length, net.map.st.length);
  assert.ok(s.city.speed > 0 && s.incidents.length > 0);
  const hist = await store.list('state_hist'); assert.equal(hist.length, 1); assert.equal(hist[0].expireAt, T0 + 72 * 3600000); assert.equal(hist[0].id, '202610070900');
  assert.ok(r1.created > 0);
  const before = await store.list('actions');
  assert.ok(before.every((a) => a.id === `A-${a.incidentId}` && a.state === 'new' && a.region));
  assert.ok(before.some((a) => a.type === 'inc')); assert.ok(before.some((a) => a.type === 'cong' && a.incidentId.startsWith('cong-2026-10-07-')), 'congestion actions at AM peak');
  const r2 = await runTick({ store, net, now: T0 });
  assert.equal(r2.created, 0);
  assert.equal((await store.list('actions')).length, before.length);
  assert.equal((await store.list('state_hist')).length, 1);
});

test('unacknowledged new actions escalate after escalateAfterMin; done actions are verified after verifyAfterMin', async () => {
  const { store } = shared;
  const acts = await store.list('actions');
  const cong = acts.find((a) => a.type === 'cong'), inc = acts.find((a) => a.type === 'inc');
  await store.update('actions', cong.id, { state: 'done', doneAt: T0 + 1 * MIN, doneBy: 'x@y.z' });
  await store.update('actions', inc.id, { state: 'ack', ackAt: T0 });
  const r = await runTick({ store, net, now: T0 + 16 * MIN });
  assert.ok(r.escalated > 0);
  const e = await store.get('actions', acts.find((a) => a.id !== cong.id && a.id !== inc.id).id);
  assert.equal(e.escalated, true); assert.equal(e.pri, 'hi'); assert.equal(e.escalatedAt, T0 + 16 * MIN);
  assert.equal((await store.get('actions', inc.id)).escalated, false, 'acknowledged actions do not escalate');
  assert.equal((await store.get('actions', cong.id)).state, 'done', 'not yet 30 min after done');
  const r2 = await runTick({ store, net, now: T0 + 16 * MIN });
  assert.equal(r2.escalated, 0, 'idempotent');
  const r3 = await runTick({ store, net, now: T0 + 32 * MIN });
  assert.equal(r3.verified, 1);
  const v = await store.get('actions', cong.id);
  assert.ok(['cleared', 'persist'].includes(v.state)); assert.equal(v.verifiedAt, T0 + 32 * MIN);
  assert.equal(typeof v.vc0, 'number'); assert.equal(typeof v.vc1, 'number');
  assert.equal(v.state, v.vc1 >= 0.9 ? 'persist' : 'cleared');
  const audits = await store.list('audit', { where: [['kind', 'in', ['action_escalate', 'action_verify']]] });
  assert.ok(audits.length >= 2);
});

test('active works constrain capacity and raise a work-start action; illustrative seeds and inactive works are ignored', async () => {
  const store = createMemoryStore();
  let e = 0; while (!(net.name[e] >= 0 && net.cls[e] === 0)) e++;
  const stn = net.map.st[net.stn[e]].n, road = net.map.n[net.name[e]];
  const base = { road, stations: [stn], from: '2026-10-07', to: '2026-10-09', hours: 'all', cap: 0.3, kind: 'roadwork', source: 'manual', by: 't', createdAt: 1 };
  await store.set('works', 'w1', { ...base, id: 'w1', name: 'Real', active: true });
  await store.set('works', 'w2', { ...base, id: 'w2', name: 'Seed', active: true, source: 'seed', illustrative: true });
  await store.set('works', 'w3', { ...base, id: 'w3', name: 'Deleted', active: false });
  await store.set('works', 'w4', { ...base, id: 'w4', name: 'Future', active: true, from: '2026-11-01', to: '2026-11-02' });
  await runTick({ store, net, now: T0 });
  const s = await store.get('state', 'current');
  assert.deepEqual(s.works.map((w) => w.id), ['w1']);
  const a = await store.get('actions', 'A-work-w1-2026-10-07');
  assert.equal(a.type, 'work'); assert.equal(a.station, stn);
});

test('calibration: live mode with a fake probe feed bounds the boost; fewer than 3 fresh observations is skipped and flagged stale', async () => {
  const store = createMemoryStore();
  await store.set('settings', 'app', { ...defaultSettings(), feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25 } });
  const hubs = net.map.hubs;
  const pairs = [[0, 1], [0, 2], [1, 2], [2, 3]];
  for (const [i, [a, b]] of pairs.entries()) await store.set('probes', `p${i}`, { id: `p${i}`, name: `P${i}`, fromNode: hubs[a].node, toNode: hubs[b].node, fromLabel: 'a', toLabel: 'b', freeMin: 20, enabled: true, weight: 1 });
  for (const i of [0, 1]) await store.set('probe_obs', `o${i}`, { id: `o${i}`, probeId: `p${i}`, at: T0 - 5 * MIN, minutes: 55, source: 'test' });
  const skip = await runTick({ store, net, now: T0 });
  let s = await store.get('state', 'current');
  assert.equal(s.mode, 'blend'); assert.equal(s.stale, true); assert.equal(s.boost, 1);
  assert.equal(s.calibration.skipped, true); assert.match(s.calibration.reason, /need 3/); assert.equal(skip.calibration.probes, 2);
  // stale observations (older than staleAfterMin) do not count
  await store.set('probe_obs', 'old', { id: 'old', probeId: 'p2', at: T0 - 60 * MIN, minutes: 55, source: 'test' });
  assert.equal((await runTick({ store, net, now: T0 })).calibration.probes, 2);
  for (const i of [2, 3]) await store.set('probe_obs', `o${i}`, { id: `o${i}`, probeId: `p${i}`, at: T0 - 2 * MIN, minutes: 80, source: 'test' });
  const ok = await runTick({ store, net, now: T0 });
  s = await store.get('state', 'current');
  assert.equal(s.stale, false); assert.equal(s.calibration.probes, 4); assert.equal(typeof s.calibration.rmsePct, 'number');
  assert.ok(s.boost >= 0.5 && s.boost <= 2, `boost ${s.boost}`); assert.equal(ok.boost, s.boost);
});

test('calibration freshness follows the probe cadence: 40-min-old readings are fresh with a 30-min paid connector, stale without one', async () => {
  const store = createMemoryStore();
  await store.set('settings', 'app', { ...defaultSettings(), feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25, idleAfterMin: 120, idleTickMin: 60 } });
  const hubs = net.map.hubs;
  for (const [i, [a, b]] of [[0, 1], [0, 2], [1, 2], [2, 3]].entries()) {
    await store.set('probes', `p${i}`, { id: `p${i}`, name: `P${i}`, fromNode: hubs[a].node, toNode: hubs[b].node, fromLabel: 'a', toLabel: 'b', freeMin: 20, enabled: true, weight: 1 });
    await store.set('probe_obs', `o${i}`, { id: `o${i}`, probeId: `p${i}`, at: T0 - 40 * MIN, minutes: 40, source: 'test' });
  }
  await runTick({ store, net, now: T0 });
  assert.equal((await store.get('state', 'current')).stale, true, 'no paid connector: 25 min window, so stale');
  await store.set('connectors', 'gr', { id: 'gr', type: 'google_routes', enabled: true, intervalMin: 30, shadow: true });
  await runTick({ store, net, now: T0 });
  const s = await store.get('state', 'current');
  assert.equal(s.stale, false); assert.equal(s.calibration.probes, 4);
});

test('settings default merge feeds the tick', async () => {
  const s = await getSettings(createMemoryStore());
  assert.equal(s.feed.tickMin, 10); assert.equal(s.workflow.escalateAfterMin, 15);
});
