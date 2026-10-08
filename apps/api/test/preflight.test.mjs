import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

test('preflight: scoped glance, one model probe per day shared across users, admin gets platform snapshot', async () => {
  const T = await makeApp(); try {
    const a = await T.call('yalahanka', 'POST', '/api/preflight');
    assert.equal(a.status, 200);
    assert.equal(a.body.api.ok, true); assert.equal(a.body.data.mode, 'sim'); assert.equal(a.body.ai.status, 'ok'); assert.equal(a.body.ai.cached, false);
    assert.equal(a.body.glance.stations, 1, 'station user sees only their own station');
    assert.equal(a.body.platform, undefined, 'platform snapshot is admin only');
    const probes = () => T.calls.filter((c) => /ready/.test(c.prompt)).length;
    assert.equal(probes(), 1);
    const b = await T.call('commissioner', 'POST', '/api/preflight');
    assert.equal(b.body.ai.cached, true); assert.equal(probes(), 1, 'second user does not trigger another model call');
    assert.ok(b.body.glance.stations > 50, 'commissioner glance is city-wide');
    const c = await T.call('admin', 'POST', '/api/preflight');
    assert.ok(c.body.platform.users.total >= 8); assert.ok(c.body.platform.system.ok > 0); assert.equal(c.body.platform.ai.cap, 400);
    assert.equal(probes(), 1);
    assert.equal((await T.call(null, 'POST', '/api/preflight')).status, 401);
  } finally { await T.app.close(); }
});

test('preflight: AI off means no model call; a failing model is reported as degraded and retried after 30 minutes', async () => {
  let fail = true;
  const T = await makeApp({ generate: async () => { if (fail) throw new Error('boom'); return { text: 'ready', tokensIn: 5, tokensOut: 1 }; } });
  try {
    const d = await T.call('viewer', 'POST', '/api/preflight'); assert.equal(d.body.ai.status, 'degraded'); assert.equal(d.status, 200);
    const again = await T.call('viewer', 'POST', '/api/preflight'); assert.equal(again.body.ai.cached, true, 'a failure is remembered for 30 minutes');
    fail = false; T.clock.advance(31 * 60000); const ok = await T.call('viewer', 'POST', '/api/preflight'); assert.equal(ok.body.ai.status, 'ok', 'recovery is picked up after the retry window');
    const T2 = await makeApp(); await T2.store.set('settings', 'app', { ai: { enabled: false } });
    const off = await T2.call('viewer', 'POST', '/api/preflight'); assert.equal(off.body.ai.status, 'off'); assert.equal(T2.calls.length, 0);
    await T2.app.close();
  } finally { await T.app.close(); }
});
