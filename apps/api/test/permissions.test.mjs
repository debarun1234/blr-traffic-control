import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, edgeIn, em } from './helpers.mjs';
import { buildServer } from '../src/server.mjs';
import { createMemoryStore } from '@blr/core';

let T; before(async () => { T = await makeApp(); await T.store.set('actions', 'A-t-yal', act('A-t-yal', 'Yalahanka', 'North')); await T.store.set('actions', 'A-t-ind', act('A-t-ind', 'Indiranagar', 'East')); });
after(() => T.app.close());
const act = (id, station, region) => ({ id, incidentId: id.slice(2), type: 'inc', edge: 1, station, region, title: 't', detail: 'd', pri: 'md', state: 'new', raisedAt: 5, raisedHour: 9, escalated: false, date: '2026-10-07' });

test('unauthenticated requests get 401, non-allowlisted 403, inactive 403 on every /api route; public probes need no auth', async () => {
  for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/state'], ['GET', '/api/actions'], ['POST', '/api/incidents'], ['GET', '/api/admin/users'], ['POST', '/api/ai/brief'], ['GET', '/api/works']]) {
    assert.equal((await T.call(null, m, u, m === 'POST' ? {} : undefined)).status, 401, `${m} ${u}`);
    assert.equal((await T.call('ghost', m, u, m === 'POST' ? {} : undefined)).status, 403, `ghost ${m} ${u}`);
    assert.equal((await T.call('gone', m, u, m === 'POST' ? {} : undefined)).status, 403, `inactive ${m} ${u}`);
  }
  const r = await T.call(null, 'GET', '/api/me', undefined, { authorization: 'Bearer junk' }); assert.equal(r.status, 401); assert.equal(r.body.error.code, 'unauthenticated');
  assert.equal((await T.call(null, 'GET', '/healthz')).status, 200); assert.equal((await T.call(null, 'GET', '/readyz')).body.store, 'ok'); assert.equal((await T.call(null, 'GET', '/api/healthz')).status, 200);
});

test('role matrix: read endpoints open to all signed-in roles; writes and admin gated by role', async () => {
  const roles = ['admin', 'commissioner', 'north.dcp', 'yalahanka', 'viewer'];
  for (const r of roles) for (const u of ['/api/me', '/api/state', '/api/crash', '/api/actions', '/api/incidents', '/api/works', '/api/ai/quota']) assert.equal((await T.call(r, 'GET', u)).status, 200, `${r} ${u}`);
  const work = { name: 'W', road: net0().road, stations: [net0().station], from: '2026-10-07', to: '2026-10-08', cap: 0.5 };
  const expectWorks = { admin: 201, commissioner: 201, 'north.dcp': 403, yalahanka: 403, viewer: 403 };
  for (const r of roles) assert.equal((await T.call(r, 'POST', '/api/works', work)).status, expectWorks[r], `works ${r}`);
  for (const r of roles) assert.equal((await T.call(r, 'GET', '/api/admin/users')).status, r === 'admin' ? 200 : 403, `admin ${r}`);
  const brief = { admin: 200, commissioner: 200, 'north.dcp': 403, yalahanka: 403, viewer: 403 };
  for (const r of roles) assert.equal((await T.call(r, 'POST', '/api/ai/brief', { scope: 'city' })).status, brief[r], `brief ${r}`);
  const adv = { admin: 200, commissioner: 200, 'north.dcp': 200, yalahanka: 200, viewer: 403 };
  for (const r of roles) assert.equal((await T.call(r, 'POST', '/api/ai/advise', { kind: 'translate_kn', context: { text: 'Road closed' } })).status, adv[r], `advise ${r}`);
  const yal = edgeIn('Yalahanka');
  const inc = { admin: 201, commissioner: 201, 'north.dcp': 201, yalahanka: 201, viewer: 403 };
  for (const r of roles) assert.equal((await T.call(r, 'POST', '/api/incidents', { edge: yal, type: 'Accident', durationMin: 30 })).status, inc[r], `incident ${r}`);
  // every admin route is closed to non-admins
  for (const [m, u] of [['GET', '/api/admin/stations'], ['GET', '/api/admin/connectors'], ['GET', '/api/admin/probes'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/checks'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/apikeys'], ['GET', '/api/admin/ai/usage'], ['POST', '/api/admin/ai/kill'], ['PUT', '/api/admin/settings'], ['POST', '/api/admin/import/works'], ['GET', '/api/admin/territories']]) for (const r of ['commissioner', 'north.dcp', 'yalahanka', 'viewer']) assert.equal((await T.call(r, m, u, m === 'GET' ? undefined : {})).status, 403, `${r} ${m} ${u}`);
});
function net0() { return { road: T.app.ctx.net.map.n[0], station: T.app.ctx.net.map.st[0].n }; }

test('actions are jurisdiction-scoped: station cannot transition another station, dcp is limited to region, viewer read-only', async () => {
  const tr = (who, id, to) => T.call(who, 'POST', `/api/actions/${id}/transition`, { to });
  assert.equal((await tr('indiranagar', 'A-t-yal', 'ack')).status, 403);
  assert.equal((await tr('yalahanka', 'A-t-ind', 'ack')).status, 403);
  assert.equal((await tr('south.dcp', 'A-t-yal', 'ack')).status, 403);
  assert.equal((await tr('north.dcp', 'A-t-ind', 'ack')).status, 403, 'East station is outside North');
  assert.equal((await tr('viewer', 'A-t-yal', 'ack')).status, 403);
  assert.equal((await T.call('yalahanka', 'GET', '/api/actions/x')).status, 404);
  assert.equal((await tr('yalahanka', 'A-missing', 'ack')).status, 404);
  assert.equal((await tr('yalahanka', 'A-t-yal', 'done')).status, 409, 'new -> done is illegal');
  assert.equal((await tr('yalahanka', 'A-t-yal', 'bogus')).status, 400);
  assert.equal((await tr('yalahanka', 'A-t-yal', 'ack')).status, 200);
  assert.equal((await tr('north.dcp', 'A-t-yal', 'prog')).status, 200);
  assert.equal((await tr('commissioner', 'A-t-ind', 'ack')).status, 200);
  assert.equal((await tr('admin', 'A-t-ind', 'prog')).status, 200);
  assert.equal((await T.store.get('actions', 'A-t-yal')).state, 'prog');
});

test('GET /api/actions: station and dcp see their region, others see all; escalated first then newest', async () => {
  await T.store.set('actions', 'A-t-esc', { ...act('A-t-esc', 'Indiranagar', 'East'), escalated: true, raisedAt: 1 });
  const ids = async (who, q = '') => (await T.call(who, 'GET', '/api/actions?state=all&limit=500' + q)).body.actions;
  const all = await ids('admin'), yal = await ids('yalahanka'), nd = await ids('north.dcp'), ind = await ids('indiranagar');
  assert.ok(all.length > yal.length); assert.ok(yal.every((a) => a.region === 'North')); assert.deepEqual(yal.map((a) => a.id), nd.map((a) => a.id));
  assert.ok(ind.every((a) => a.region === 'East') && ind.some((a) => a.id === 'A-t-esc'));
  assert.equal(ind[0].id, 'A-t-esc', 'escalated first even though oldest');
  assert.ok(all.every((a, i) => i === 0 || (all[i - 1].escalated === true) >= (a.escalated === true)));
  const open = (await T.call('admin', 'GET', '/api/actions?state=open')).body.actions; assert.ok(open.every((a) => ['new', 'ack', 'prog', 'persist'].includes(a.state)));
  assert.equal((await T.call('admin', 'GET', '/api/actions?state=zzz')).status, 400);
});

test('dev auth is refused when NODE_ENV=production', async () => {
  await assert.rejects(buildServer({ store: createMemoryStore(), logger: false, env: { AUTH_MODE: 'dev', NODE_ENV: 'production' } }), /AUTH_MODE=dev/);
  const prod = await buildServer({ store: createMemoryStore(), logger: false, env: { NODE_ENV: 'production' } });
  const r = await prod.inject({ method: 'GET', url: '/api/me', headers: { 'x-dev-user': em('admin') } }); assert.equal(r.statusCode, 401, 'dev header ignored in production');
  assert.ok(r.headers['strict-transport-security']); await prod.close();
});
