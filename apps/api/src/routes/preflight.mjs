// Welcome-page pre-entry checks. Any signed-in role. The model probe runs at most once per IST day for the whole system
// (result stored in checks/ai-<day>); admins also get the daily system-check run and a platform snapshot.
import { jurisdiction } from '@blr/shared';
import { runChecks, istDay } from '@blr/core';

const OPEN = ['new', 'ack', 'prog', 'persist'];

export function registerPreflight(api, ctx) {
  const { store, net, clock } = ctx, stations = net.map.st;
  let aiFlight = null, sysFlight = null;

  const aiDaily = async (now) => {
    const id = `ai-${istDay(now)}`, hit = await store.get('checks', id);
    // a healthy probe lasts the whole day; a failed one is re-tried after 30 minutes so a recovery shows up without hammering a broken model
    if (hit && (hit.result.status !== 'degraded' || now - hit.at < 30 * 60000)) return { ...hit.result, cached: true, checkedAt: hit.at };
    if (!ctx.ai?.ping) return { status: 'unconfigured', detail: 'AI is not configured on this deployment', cached: false };
    aiFlight ??= (async () => {
      const r = await ctx.ai.ping();
      if (r.status === 'ok' || r.status === 'degraded') await store.set('checks', id, { id, at: now, result: r, expireAt: now + 36 * 3600000 }).catch(() => {});
      return r;
    })().finally(() => { aiFlight = null; });
    const r = await aiFlight; return { ...r, cached: false, checkedAt: now };
  };
  const sysDaily = async (now) => {
    const latest = await store.get('checks', 'latest');
    if (latest && istDay(latest.at) === istDay(now)) return { ...latest, cached: true };
    sysFlight ??= runChecks({ store, net, clock, env: ctx.env, timeSource: ctx.timeSource }).finally(() => { sysFlight = null; });
    return { ...(await sysFlight), cached: false };
  };

  api.post('/preflight', async (req) => {
    const u = req.user, now = clock.now(), s = await ctx.settings(), t0 = performance.now();
    await store.get('settings', 'app'); // store round-trip
    const apiMs = Math.round(performance.now() - t0);
    const state = await store.get('state', 'current');
    const age = state ? Math.round((now - state.updatedAt) / 60000) : null;
    const data = state
      ? { ok: !state.stale && age <= s.feed.staleAfterMin, mode: state.mode, ageMin: age, stale: !!state.stale || age > s.feed.staleAfterMin, limitMin: s.feed.staleAfterMin }
      : { ok: false, mode: null, ageMin: null, stale: true, limitMin: s.feed.staleAfterMin };
    const ai = s.maintenance ? { status: 'off', detail: 'maintenance mode', cached: true } : await aiDaily(now);

    // Scoped snapshot for the welcome card.
    const j = jurisdiction(u, stations), all = u.role === 'admin' || u.role === 'commissioner' || u.role === 'viewer';
    const inScope = (name) => all || j.has(name);
    const incidents = (state?.incidents ?? []).filter((i) => inScope(stations[i.station]?.n)).length;
    const actions = (await store.list('actions', { where: [['state', 'in', OPEN]] })).filter((a) => inScope(a.station)).length;
    const works = (await store.list('works', { where: [['active', '==', true]] })).filter((w) => all || (w.stations ?? [w.station]).some((n) => j.has(n))).length;
    const out = { at: now, day: istDay(now), api: { ok: true, ms: apiMs }, data, ai, glance: { incidents, actions, works, stations: all ? stations.length : j.size, mode: state?.mode ?? null }, maintenance: !!s.maintenance };

    if (u.role === 'admin') {
      const sys = await sysDaily(now), counts = { ok: 0, warn: 0, fail: 0 }; for (const r of sys.results ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
      const users = await store.list('users'), cons = await store.list('connectors'), usage = (await store.get('ai_usage', istDay(now))) ?? { calls: 0 };
      out.platform = {
        system: { at: sys.at ?? null, cached: !!sys.cached, ...counts, worst: (sys.results ?? []).filter((r) => r.status !== 'ok').slice(0, 3).map((r) => ({ name: r.name, status: r.status, detail: r.detail })) },
        users: { active: users.filter((x) => x.active !== false).length, total: users.length },
        connectors: { enabled: cons.filter((c) => c.enabled).length, failing: cons.filter((c) => (c.lastRun && !c.lastRun.ok) || c.disabledReason).length, total: cons.length },
        ai: { calls: usage.calls ?? 0, cap: s.ai.dailyCallCap },
      };
    }
    return out;
  });
}
