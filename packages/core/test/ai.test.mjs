import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiRouter, routeTask, defaultSettings, adviceTemplate, actionContext, detourAround, buildPrompt, cleanContext, sanitiseOutput, istDay } from '../src/index.mjs';
import { net, mk } from './helpers.mjs';

const U = (role, email = `${role}@x.test`) => ({ email, role, active: true });
function setup(over = {}) {
  const { store, clock } = mk(); const calls = [];
  const generate = over.generate ?? (async () => ({ text: '```\nRoute via X.\n```', tokensIn: 1000, tokensOut: 200 }));
  const wrapped = async (o) => { calls.push(o); return generate(o); };
  return { store, clock, calls, ai: createAiRouter({ store, clock, generate: wrapped }) };
}
const big = { type: 'inc', title: 'Accident on Hosur Road', road: 'Hosur Road', station: 'Adugodi', region: 'South', pri: 'hi', incType: 'Accident', cap: 0.4, endHour: 10, vc: 1.3, speed: 12, hour: 9, simulated: true, alternates: { roads: ['A Road', 'B Road'], extraKm: 1.2 } };

test('routeTask: advice always goes to the model (t2); translate t1; clash t2; brief t3', () => {
  assert.equal(routeTask('action_advice', { title: 'x', vc: 1 }), 't2');
  assert.equal(routeTask('action_advice', { title: 'x', question: 'what now?' }), 't2');
  assert.equal(routeTask('action_advice', { detail: 'x'.repeat(500) }), 't2');
  assert.equal(routeTask('translate_kn'), 't1'); assert.equal(routeTask('works_clash'), 't2'); assert.equal(routeTask('brief'), 't3');
  assert.throws(() => routeTask('nope'));
});

test('t0 template is the fallback when AI is off: no model call, mentions alternates and simulated data, usage counts t0 only', async () => {
  const { ai, calls, store } = setup(); await store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, enabled: false } });
  const r = await ai.advise({ user: U('station'), kind: 'action_advice', context: { title: 'Accident on Hosur Road', road: 'Hosur Road', incType: 'Accident', vc: 1.3, alternates: { roads: ['A Road'], extraKm: 1.2 }, simulated: true } });
  assert.equal(r.tier, 't0'); assert.equal(calls.length, 0); assert.match(r.text, /Divert via A Road/); assert.match(r.text, /simulated/);
  const u = await store.get('ai_usage', istDay(Date.parse('2026-10-07T03:30:00Z'))); assert.equal(u.byTier.t0, 1); assert.equal(u.calls, 0);
});

test('model tiers: model from settings, token cap, sanitised output, usage with estimated cost, cache hit on repeat', async () => {
  const { ai, calls, store, clock } = setup();
  const req = { user: U('dcp'), kind: 'action_advice', context: { ...big, question: 'Which junction first?' } };
  const r1 = await ai.advise(req);
  assert.deepEqual([r1.tier, r1.cached, r1.model, r1.text], ['t2', false, defaultSettings().ai.tiers.t2.model, 'Route via X.']);
  assert.equal(calls[0].maxOutputTokens, 800, 'floor: thinking tokens share the output budget'); assert.match(calls[0].prompt, /simulated/); assert.ok(!/@/.test(calls[0].prompt));
  const r2 = await ai.advise(req); assert.equal(r2.cached, true); assert.equal(calls.length, 1);
  const u = await store.get('ai_usage', istDay(clock.now()));
  assert.equal(u.calls, 1); assert.equal(u.cacheHits, 1); assert.equal(u.tokensIn, 1000); assert.equal(u.byUser['dcp@x.test'], 1); assert.ok(u.estCostUsd > 0); assert.match(u.costNote, /estimate/);
  assert.ok(Math.abs(u.estCostUsd - (1000 * 0.3 + 200 * 2.5) / 1e6) < 1e-9);
  clock.advance(25 * 3600000);
  assert.equal((await ai.advise(req)).cached, false, 'cache TTL is 24 h');
  const t = await ai.advise({ user: U('station'), kind: 'translate_kn', context: { text: 'Road closed, call +91 98450 12345 or a@b.co' } });
  assert.equal(t.tier, 't1'); assert.ok(!/98450|a@b/.test(calls.at(-1).prompt), 'PII scrubbed from prompts');
});

test('guards: maintenance, kill switch, permission, per-user quota, global cap, tier disabled, generate failure/timeouts', async () => {
  const { ai, store, calls } = setup();
  const ctx = { ...big, question: 'q' };
  await assert.rejects(ai.advise({ user: U('viewer'), kind: 'action_advice', context: ctx }), { code: 'forbidden' });
  await assert.rejects(ai.advise({ user: U('station'), kind: 'nope', context: {} }), { code: 'invalid' });
  await assert.rejects(ai.brief({ user: U('dcp'), scope: 'city', context: { scope: 'city' } }), { code: 'forbidden' });
  // per-user quota
  await store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, perUserDaily: { ...defaultSettings().ai.perUserDaily, station: 1 } } });
  await ai.advise({ user: U('station'), kind: 'action_advice', context: ctx });
  const over = await ai.advise({ user: U('station'), kind: 'action_advice', context: { ...ctx, question: 'other' } });
  assert.deepEqual([over.tier, over.fallback], ['t0', 'quota'], 'advice falls back to the template when the quota is used up');
  await ai.advise({ user: U('station', 'other@x.test'), kind: 'action_advice', context: { ...ctx, question: 'other' } });
  // global cap
  await store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, dailyCallCap: 2 } });
  assert.equal((await ai.advise({ user: U('admin'), kind: 'action_advice', context: { ...ctx, question: 'third' } })).fallback, 'quota');
  await assert.rejects(ai.advise({ user: U('admin'), kind: 'translate_kn', context: { text: 'third' } }), (e) => e.code === 'quota_exceeded' && /whole system/.test(e.message));
  // kill switch: models refused, but template advice still works
  await store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, enabled: false, killReason: 'budget' } });
  const n = calls.length;
  await assert.rejects(ai.advise({ user: U('admin'), kind: 'translate_kn', context: { text: 'hello' } }), (e) => e.code === 'unavailable' && /budget/.test(e.message));
  assert.equal((await ai.advise({ user: U('admin'), kind: 'action_advice', context: { title: 'x' } })).tier, 't0');
  assert.equal((await ai.advise({ user: U('admin'), kind: 'action_advice', context: ctx })).tier, 't0', 'falls back to template when AI is off');
  assert.equal(calls.length, n);
  assert.equal((await ai.quota(U('admin'))).aiEnabled, false);
  // maintenance beats everything
  await store.set('settings', 'app', { ...defaultSettings(), maintenance: true });
  await assert.rejects(ai.advise({ user: U('admin'), kind: 'action_advice', context: { title: 'x' } }), { code: 'unavailable' });
});

test('generate errors and timeouts surface as unavailable and are not charged', async () => {
  const bad = setup({ generate: async () => { throw new Error('vertex 500 secret-detail'); } });
  await assert.rejects(bad.ai.advise({ user: U('admin'), kind: 'translate_kn', context: { text: 'hi' } }), (e) => e.code === 'unavailable' && !/secret-detail/.test(e.message));
  assert.equal(await bad.store.get('ai_usage', istDay(bad.clock.now())), null);
  const slow = setup({ generate: () => new Promise(() => {}) });
  await slow.store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, timeoutMs: { t1: 1000, t2: 1000, t3: 1000 } } });
  await assert.rejects(slow.ai.advise({ user: U('admin'), kind: 'translate_kn', context: { text: 'hi' } }), /timed out/);
});

test('brief: t3, cached per scope and IST hour, daily brief limit, quota endpoint', async () => {
  const { ai, calls, clock, store } = setup();
  const ctx = { scope: 'city', avgSpeedKmh: 22, simulated: true };
  const b1 = await ai.brief({ user: U('commissioner'), scope: 'city', context: ctx });
  assert.equal(b1.tier, 't3'); assert.equal(b1.cached, false); assert.equal(calls[0].maxOutputTokens, 1500); assert.equal(calls[0].model, defaultSettings().ai.tiers.t3.model);
  assert.equal((await ai.brief({ user: U('admin'), scope: 'city', context: { ...ctx, avgSpeedKmh: 23 } })).cached, true, 'same scope + hour');
  assert.equal((await ai.brief({ user: U('admin'), scope: 'North', context: { ...ctx, scope: 'North' } })).cached, false);
  clock.advance(3600000);
  assert.equal((await ai.brief({ user: U('commissioner'), scope: 'city', context: ctx })).cached, false);
  await store.set('settings', 'app', { ...defaultSettings(), ai: { ...defaultSettings().ai, briefPerDay: 3 } });
  await assert.rejects(ai.brief({ user: U('admin'), scope: 'South', context: { ...ctx, scope: 'South' } }), (e) => e.code === 'quota_exceeded' && /brief/.test(e.message));
  const q = await ai.quota(U('commissioner')); assert.equal(q.used, 2); assert.equal(q.limit, 60); assert.ok(q.resetsAt > clock.now()); assert.equal(q.aiEnabled, true);
});

test('graph alternates and action context come from the road graph and stored state', () => {
  let e = 0, alt = null;
  for (; e < net.ne && !alt; e++) if (net.name[e] >= 0 && net.cls[e] <= 1 && net.len[e] > 150) { alt = detourAround(net, e); if (alt && !alt.roads.length) alt = null; }
  e--; assert.ok(alt && alt.roads.length >= 1 && alt.extraM >= 0, 'finds a detour for some arterial segment');
  const ctx = actionContext({ net, state: { vc: Buffer.alloc(net.ne, 120).toString('base64'), spd: Buffer.alloc(net.ne, 15).toString('base64'), hour: 9, mode: 'sim' }, action: { type: 'cong', edge: e, title: 'Congestion', station: 's', region: 'North', pri: 'md' } });
  assert.equal(ctx.vc, 1.2); assert.equal(ctx.speed, 15); assert.ok(ctx.road); assert.equal(ctx.simulated, true);
  assert.match(adviceTemplate(ctx), /1\.20/);
});

test('prompt hygiene: unknown fields dropped, fences stripped, output capped', () => {
  const c = cleanContext('action_advice', { title: 'T', secretField: 'x', note: 'call me at 9845012345', alternates: null });
  assert.ok(!('secretField' in c) && !('note' in c));
  assert.match(buildPrompt('brief', { scope: 'city', simulated: true }), /simulated/);
  assert.equal(sanitiseOutput('```json\nabc\n```'), 'abc'); assert.equal(sanitiseOutput('x'.repeat(9000), 100).length, 100);
});

test('advice falls back to the template when the model fails; a cut-off answer is trimmed to a full sentence and not cached', async () => {
  let n = 0;
  const { ai, store } = setup({ generate: async () => { n++; if (n === 1) throw new Error('boom'); return { text: 'Send a unit to Hosur Road now. Hold traffic at the upstream junc', truncated: true }; } });
  const ctx = { ...big, question: 'q' };
  const r = await ai.advise({ user: U('dcp'), kind: 'action_advice', context: ctx });
  assert.deepEqual([r.tier, r.fallback], ['t0', 'error']); assert.match(r.text, /Divert via/);
  const t = await ai.advise({ user: U('dcp'), kind: 'action_advice', context: { ...ctx, question: 'again' } });
  assert.equal(t.tier, 't2'); assert.equal(t.text, 'Send a unit to Hosur Road now.');
  assert.equal((await store.list('ai_cache')).length, 0, 'truncated output is not cached');
});

test('thinking budget is kept small so it cannot eat the visible answer', async () => {
  const { thinkingFor } = await import('../src/ai/generate.mjs');
  assert.deepEqual(thinkingFor('gemini-3.1-pro-preview'), { thinkingLevel: 'LOW' });
  assert.deepEqual(thinkingFor('gemini-3-flash-preview'), { thinkingLevel: 'LOW' });
  assert.deepEqual(thinkingFor('gemini-2.5-flash'), { thinkingBudget: 0 });
  assert.deepEqual(thinkingFor('gemini-2.5-pro'), { thinkingBudget: 128 });
  assert.equal(thinkingFor('something-else'), null);
});

test('brief context carries regions, incidents, escalated waits and the next peak; prompts ask for a specific plan', async () => {
  const { briefContext, peakInfo } = await import('../src/index.mjs');
  assert.match(peakInfo(23), /next demand peak starts 07:00/); assert.match(peakInfo(8), /until 11:00/);
  const p = buildPrompt('brief', { scope: 'city', peak: 'x' }); assert.match(p, /four short paragraphs/); assert.match(p, /Outlook/);
  const a = buildPrompt('action_advice', { title: 't', ageMin: 40 }); assert.match(a, /who does what and where/); assert.match(a, /15 minutes/);
});
