import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { decodeState } from '@blr/model';
import { makeApp, edgeIn, em, net, T0 } from './helpers.mjs';

let T; before(async () => { T = await makeApp(); });
after(() => T.app.close());
const audits = async (kind) => (await T.store.list('audit', { where: [['kind', '==', kind]] }));

test('GET /api/state: contract shape, ETag + 304, stale flag derived from age', async () => {
  const r = await T.call('viewer', 'GET', '/api/state');
  assert.equal(r.status, 200); const s = r.body;
  for (const k of ['t', 'hour', 'date', 'mode', 'boost', 'stale', 'updatedAt', 'net', 'city', 'stations', 'vc', 'spd', 'incidents', 'works', 'calibration']) assert.ok(k in s, k);
  assert.equal(decodeState({ vc: s.vc, spd: s.spd, n: s.net.edges }).vc.length, net.ne); assert.equal(s.stale, false);
  const tag = r.headers.etag; assert.ok(tag);
  const r2 = await T.call('viewer', 'GET', '/api/state', undefined, { 'if-none-match': tag }); assert.equal(r2.status, 304); assert.equal(r2.text, '');
  T.clock.advance(26 * 60000);
  const r3 = await T.call('viewer', 'GET', '/api/state', undefined, { 'if-none-match': tag });
  assert.equal(r3.status, 200); assert.equal(r3.body.stale, true); assert.notEqual(r3.headers.etag, tag);
  T.clock.advance(-26 * 60000);
});

test('GET /api/me returns role, permissions, jurisdiction and flags', async () => {
  const me = (await T.call('yalahanka', 'GET', '/api/me')).body;
  assert.deepEqual([me.email, me.role, me.station, me.region, me.lockedRegion], ['yalahanka@example.test', 'station', 'Yalahanka', 'North', 'North']);
  assert.deepEqual(me.jurisdiction, ['Yalahanka']); assert.ok(me.permissions.includes('incident.report') && !me.permissions.includes('works.write')); assert.deepEqual(me.flags, { aiEnabled: true, maintenance: false }); assert.equal(me.map.defaultView, 'traffic'); assert.equal(me.map.speedBands.fast, 34);
  const a = (await T.call('admin', 'GET', '/api/me')).body; assert.equal(a.lockedRegion, null); assert.equal(a.jurisdiction.length, net.map.st.length); assert.ok(a.permissions.includes('admin.access'));
  assert.equal((await T.call('north.dcp', 'GET', '/api/me')).body.jurisdiction.length, net.map.st.filter((s) => s.r === 'North').length);
});

test('action state machine writes audit rows with actor; done can be reopened; note is audited', async () => {
  const a = (await T.call('admin', 'GET', '/api/actions?state=open')).body.actions.find((x) => x.station);
  const tr = (to, who = 'admin', note) => T.call(who, 'POST', `/api/actions/${a.id}/transition`, { to, note });
  const ack = await tr('ack', 'admin', 'on it'); assert.equal(ack.status, 200); assert.equal(ack.body.ackBy, em('admin')); assert.equal(ack.body.ackAt, T0);
  assert.equal((await tr('ack')).status, 409); assert.equal((await tr('done')).status, 409);
  assert.equal((await tr('prog')).body.state, 'prog'); const done = await tr('done'); assert.equal(done.body.doneBy, em('admin'));
  assert.equal((await tr('prog')).body.state, 'prog', 'done -> prog reopens');
  const rows = (await audits('action_transition')).filter((r) => r.target === a.id);
  assert.equal(rows.length, 4); assert.ok(rows.every((r) => r.actor === em('admin') && r.role === 'admin' && r.at === T0)); assert.ok(rows.some((r) => r.meta?.note === 'on it'));
});

test('incident report creates an incident and a new action visible to the right users; jurisdiction and validation enforced', async () => {
  const e = edgeIn('Yalahanka');
  const r = await T.call('yalahanka', 'POST', '/api/incidents', { edge: e, type: 'Tree fall', durationMin: 60, note: 'near the bus stop' });
  assert.equal(r.status, 201); const { incident, action } = r.body;
  assert.deepEqual([incident.src, incident.station, incident.by, incident.cap, incident.date], ['user', 'Yalahanka', em('yalahanka'), 0.35, '2026-10-07']);
  assert.equal(incident.endHour - incident.startHour, 1); assert.equal(action.id, `A-${incident.id}`); assert.equal(action.state, 'new'); assert.equal(action.type, 'inc'); assert.equal(action.region, 'North'); assert.match(action.detail, /near the bus stop/);
  assert.ok((await T.call('north.dcp', 'GET', '/api/actions')).body.actions.some((x) => x.id === action.id));
  assert.ok(!(await T.call('indiranagar', 'GET', '/api/actions')).body.actions.some((x) => x.id === action.id), 'other region does not see it');
  assert.ok((await T.call('viewer', 'GET', '/api/incidents')).body.incidents.some((x) => x.id === incident.id));
  assert.equal((await audits('incident_report')).length >= 1, true);
  assert.equal((await T.call('indiranagar', 'POST', '/api/incidents', { edge: e, type: 'Accident', durationMin: 30 })).status, 403);
  for (const bad of [{ edge: -1, type: 'x', durationMin: 30 }, { edge: 1.5, type: 'x', durationMin: 30 }, { edge: e, type: '', durationMin: 30 }, { edge: e, type: 'x', durationMin: 5 }, { edge: e, type: 'x', durationMin: 241 }, { edge: e, type: 'x', durationMin: 30, evil: 1 }, { edge: net.ne, type: 'x', durationMin: 30 }]) assert.equal((await T.call('admin', 'POST', '/api/incidents', bad)).status, 400, JSON.stringify(bad));
  const sim = (await T.call('viewer', 'GET', '/api/incidents?date=2026-10-07')).body.incidents.filter((i) => i.src === 'sim'); assert.ok(sim.length > 0);
  assert.equal((await T.call('viewer', 'GET', '/api/incidents?date=nope')).status, 400);
});

test('works: create, validate, patch, soft delete, audit; inactive hidden from the default list', async () => {
  const st = net.map.st[5].n, road = net.map.n[3], base = { name: 'Metro', road, stations: [st], from: '2026-10-07', to: '2026-10-20', hours: 'peak', cap: 0.6, kind: 'metro', agency: 'BMRCL' };
  const c = await T.call('commissioner', 'POST', '/api/works', base); assert.equal(c.status, 201);
  const w = c.body; assert.deepEqual([w.source, w.active, w.by, w.cap], ['manual', true, em('commissioner'), 0.6]);
  for (const bad of [{ ...base, cap: 2 }, { ...base, stations: ['Atlantis'] }, { ...base, from: '2026-10-30' }, { ...base, hours: 'noon' }, { ...base, extra: 1 }, { ...base, name: '' }]) assert.equal((await T.call('admin', 'POST', '/api/works', bad)).status, 400, JSON.stringify(bad));
  const p = await T.call('admin', 'PATCH', `/api/works/${w.id}`, { cap: 0.4, to: '2026-10-25' }); assert.equal(p.status, 200); assert.equal(p.body.cap, 0.4); assert.equal(p.body.name, 'Metro');
  assert.equal((await T.call('admin', 'PATCH', `/api/works/${w.id}`, { to: '2026-09-01' })).status, 400);
  assert.equal((await T.call('admin', 'PATCH', '/api/works/nope', { cap: 0.4 })).status, 404);
  assert.equal((await T.call('yalahanka', 'DELETE', `/api/works/${w.id}`)).status, 403);
  const d = await T.call('commissioner', 'DELETE', `/api/works/${w.id}`); assert.equal(d.status, 200); assert.equal(d.body.active, false);
  assert.ok(!(await T.call('viewer', 'GET', '/api/works')).body.works.some((x) => x.id === w.id));
  assert.ok((await T.call('viewer', 'GET', '/api/works?includeInactive=1')).body.works.some((x) => x.id === w.id));
  assert.ok(await T.store.get('works', w.id), 'soft delete keeps the document');
  assert.deepEqual((await T.store.list('audit')).filter((a) => a.target === w.id).map((a) => a.kind).sort(), ['works_create', 'works_delete', 'works_update']);
});

test('AI endpoints: template advice from an action, brief cached per hour, quota, kill switch and /api/me flag', async () => {
  const a = (await T.call('admin', 'GET', '/api/actions?state=open')).body.actions.find((x) => x.edge >= 0 && x.type === 'cong') ?? (await T.call('admin', 'GET', '/api/actions?state=open')).body.actions[0];
  const adv = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id } });
  assert.equal(adv.status, 200); assert.equal(adv.body.tier, 't0'); assert.match(adv.body.text, /modelled|simulated/i); assert.equal(T.calls.filter((c) => /action_advice|SITUATION/.test(c.prompt)).length, 0);
  const q = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id, question: 'Which junction first?' } });
  assert.equal(q.body.tier, 't2'); assert.match(q.body.text, /^AI\[/); assert.ok(q.body.model);
  assert.equal((await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: 'nope' } })).status, 404);
  assert.equal((await T.call('admin', 'POST', '/api/ai/advise', { kind: 'bogus', context: {} })).status, 400);
  const w = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'works_clash', context: {} }); assert.equal(w.body.tier, 't2');
  const b1 = await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'city' }), b2 = await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'city' });
  assert.equal(b1.body.tier, 't3'); assert.equal(b1.body.cached, false); assert.equal(b2.body.cached, true); assert.ok(b1.body.generatedAt);
  assert.match(T.calls.find((c) => c.prompt.includes('briefing')).prompt, /"simulated":true/);
  assert.equal((await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'Narnia' })).status, 400);
  const quota = (await T.call('commissioner', 'GET', '/api/ai/quota')).body; assert.deepEqual([quota.used, quota.limit, quota.aiEnabled], [1, 60, true]); assert.ok(quota.resetsAt > T0);
  const kill = await T.call('admin', 'POST', '/api/admin/ai/kill', { enabled: false, reason: 'cost spike' }); assert.equal(kill.status, 200);
  assert.equal((await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'South' })).status, 503);
  assert.equal((await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'Urban' })).status, 503); // valid scope: passes validation, then the kill switch applies
  assert.equal((await T.call('viewer', 'GET', '/api/me')).body.flags.aiEnabled, false); assert.equal((await T.call('viewer', 'GET', '/api/ai/quota')).body.aiEnabled, false);
  assert.equal((await T.call('admin', 'POST', '/api/admin/ai/kill', { enabled: false })).status, 400, 'reason required when disabling');
  await T.call('admin', 'POST', '/api/admin/ai/kill', { enabled: true });
  assert.equal((await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'South' })).status, 200);
  assert.deepEqual((await audits('ai_kill')).map((r) => r.summary).sort(), ['Disabled AI: cost spike', 'Enabled AI']);
});

test('platform: security headers, JSON errors, size limit, rate limiting, readiness failure', async () => {
  const r = await T.call('viewer', 'GET', '/api/crash');
  assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['cache-control'], 'no-store'); assert.ok(!r.headers['access-control-allow-origin']);
  const nf = await T.call('viewer', 'GET', '/api/nope'); assert.equal(nf.status, 404); assert.equal(nf.body.error.code, 'not_found');
  const big = await T.call('admin', 'POST', '/api/works', { name: 'x'.repeat(300 * 1024) }); assert.equal(big.status, 413);
  assert.equal((await T.call('admin', 'DELETE', '/api/works/nope', undefined, { 'content-type': 'application/json' })).status, 404, 'empty JSON body is tolerated');
  assert.equal((await T.call('admin', 'POST', '/api/works', '{bad json', { 'content-type': 'application/json' })).status, 400);
  const lim = await makeApp({ tick: false, serverOpts: { rateLimit: { perMinute: 3 } } });
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await lim.call('viewer', 'GET', '/api/me')).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]); assert.equal((await lim.call('viewer', 'GET', '/healthz')).status, 200, 'probes are not rate limited');
  const r429 = await lim.call('viewer', 'GET', '/api/me'); assert.equal(r429.body.error.code, 'rate_limited'); assert.ok(r429.headers['retry-after']); await lim.app.close();
  const sick = await makeApp({ tick: false }); const orig = sick.store.get; sick.store.get = async (c, id) => { if (c === 'settings') throw new Error('down'); return orig(c, id); };
  assert.equal((await sick.call(null, 'GET', '/readyz')).status, 503); await sick.app.close();
});

test('AI output follows the requested language (Kannada templates, model prompt, separate cache)', async () => {
  const a = (await T.call('admin', 'GET', '/api/actions?state=open')).body.actions[0];
  const kn = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id }, lang: 'kn' });
  assert.equal(kn.status, 200); assert.equal(kn.body.tier, 't0'); assert.match(kn.body.text, /[\u0C80-\u0CFF]/, 'template is in Kannada script');
  const en = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id } });
  assert.doesNotMatch(en.body.text, /[\u0C80-\u0CFF]/); assert.equal(en.body.cached, false, 'languages are cached separately');
  const q = await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id, question: 'ಮೊದಲು ಯಾವ ಜಂಕ್ಷನ್?' }, lang: 'kn' });
  assert.match(T.calls.at(-1).prompt, /Kannada/);
  assert.equal((await T.call('admin', 'POST', '/api/ai/advise', { kind: 'action_advice', context: { actionId: a.id }, lang: 'fr' })).status, 400);
  const b = await T.call('commissioner', 'POST', '/api/ai/brief', { scope: 'city', lang: 'kn' }); assert.equal(b.status, 200); assert.match(T.calls.at(-1).prompt, /Kannada/);
});

test('using the app records activity for the idle-aware worker (throttled)', async () => {
  T.clock.advance(24 * 3600000); await T.store.delete?.('state', 'activity');
  await T.call('admin', 'GET', '/api/me'); await new Promise((r) => setTimeout(r, 20));
  const a = await T.store.get('state', 'activity'); assert.ok(a?.lastSeenAt > 0, '/me records activity');
  await T.store.set('state', 'activity', { id: 'activity', lastSeenAt: 1 }); await T.call('admin', 'GET', '/api/me'); await new Promise((r) => setTimeout(r, 20));
  assert.equal((await T.store.get('state', 'activity')).lastSeenAt, 1, 'a second call inside the throttle window does not write again');
});
