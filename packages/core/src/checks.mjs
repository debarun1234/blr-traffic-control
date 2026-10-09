import { getSettings } from './settings.mjs';
import { bootstrapAdmins } from './auth.mjs';
import { istDay } from './util.mjs';
import { callsToday } from './connectors/types.mjs';
import { mapVersion } from './engine.mjs';

/** Default clock-skew reference: HTTP Date header of a Google endpoint. Returns epoch ms. */
export const httpTimeSource = (fetch = globalThis.fetch) => async () => {
  const r = await fetch('https://www.google.com/generate_204', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
  const d = Date.parse(r.headers.get('date')); if (!Number.isFinite(d)) throw new Error('no Date header'); return d;
};

/**
 * Run all system checks and write checks/latest. Each result: {id,name,status:'ok'|'warn'|'fail',detail,ms}.
 * @param {{store:any, net:any, clock:{now():number}, env?:object, timeSource?:()=>Promise<number>}} o
 */
export async function runChecks({ store, net, clock, env = process.env, timeSource }) {
  const results = [];
  const add = async (id, name, fn) => {
    const t0 = performance.now(); let status = 'ok', detail = '';
    try { const r = await fn(); status = r.status ?? 'ok'; detail = r.detail ?? ''; } catch (e) { status = 'fail'; detail = String(e?.message ?? e).slice(0, 200); }
    results.push({ id, name, status, detail, ms: Math.round(performance.now() - t0) });
  };
  const now = clock.now(), s = await getSettings(store, env).catch(() => null);
  await add('store', 'Store read/write', async () => {
    const id = `probe-${now}`; await store.set('checks', id, { id, at: now, expireAt: now + 60000 });
    const back = await store.get('checks', id); await store.delete('checks', id);
    return back?.at === now ? { detail: `${store.kind ?? 'store'} round-trip ok` } : { status: 'fail', detail: 'read-back mismatch' };
  });
  await add('auth', 'Auth configuration', async () => {
    if (env.AUTH_MODE === 'dev') return env.NODE_ENV === 'production' ? { status: 'fail', detail: 'AUTH_MODE=dev in production' } : { status: 'warn', detail: 'AUTH_MODE=dev (development only)' };
    const admins = (await store.list('users', { where: [['role', '==', 'admin'], ['active', '==', true]] })).length;
    if (!admins && !bootstrapAdmins(env).size) return { status: 'fail', detail: 'no active admin and no BOOTSTRAP_ADMIN_EMAILS' };
    return { detail: `${admins} active admin(s), ${bootstrapAdmins(env).size} bootstrap email(s)` };
  });
  const state = await store.get('state', 'current'), meta = await store.get('state', 'meta');
  await add('feed', 'Feed freshness', async () => {
    if (!state) return { status: 'fail', detail: 'no state yet' };
    const age = Math.round((now - state.updatedAt) / 60000), lim = meta?.idle ? s.feed.idleTickMin + s.feed.tickMin : s.feed.staleAfterMin;
    return age > lim ? { status: 'fail', detail: `state is ${age} min old (limit ${lim})` } : state.stale ? { status: 'warn', detail: `mode ${state.mode}: ${state.calibration?.reason ?? 'feed stale'}` } : { detail: `${age} min old, mode ${state.mode}` };
  });
  await add('scheduler', 'Scheduler lag', async () => {
    if (!state) return { status: 'fail', detail: 'no tick has run' };
    const every = meta?.idle ? s.feed.idleTickMin : s.feed.tickMin, lag = Math.round((now - state.updatedAt) / 60000) - every;
    return lag > 3 * every ? { status: 'fail', detail: `${lag} min late` } : lag > every ? { status: 'warn', detail: `${lag} min late` } : { detail: `${Math.max(0, lag)} min late` };
  });
  await add('tick_duration', 'Last tick duration', async () => {
    if (!meta) return { status: 'warn', detail: 'no tick recorded' };
    return meta.tickMs > 20000 ? { status: 'fail', detail: `${meta.tickMs} ms` } : meta.tickMs > 8000 ? { status: 'warn', detail: `${meta.tickMs} ms` } : { detail: `${meta.tickMs} ms` };
  });
  await add('connectors', 'Connector health', async () => {
    const cs = await store.list('connectors');
    const broken = cs.filter((c) => c.lastRun && !c.lastRun.ok), off = cs.filter((c) => c.disabledReason);
    if (off.length) return { status: 'fail', detail: `auto-disabled: ${off.map((c) => c.name).join(', ')}` };
    if (broken.length) return { status: 'warn', detail: `failing: ${broken.map((c) => c.name).join(', ')}` };
    return { detail: `${cs.filter((c) => c.enabled).length} enabled of ${cs.length}` };
  });
  await add('ai', 'AI kill switch and budget', async () => {
    const u = (await store.get('ai_usage', istDay(now))) ?? { calls: 0, estCostUsd: 0 };
    const routes = await callsToday(store, 'routes', now), tt = await callsToday(store, 'tomtom', now);
    const d = `${u.calls}/${s.ai.dailyCallCap} calls, est. $${(u.estCostUsd ?? 0).toFixed(4)}; routes ${routes}/${s.caps.routesCallsPerDay}, tomtom ${tt}/${s.caps.tomtomCallsPerDay}`;
    if (!s.ai.enabled) return { status: 'warn', detail: `AI disabled${s.ai.killReason ? ` (${s.ai.killReason})` : ''}; ${d}` };
    return u.calls >= 0.9 * s.ai.dailyCallCap ? { status: 'warn', detail: `near daily cap; ${d}` } : { detail: d };
  });
  await add('map', 'Map integrity', async () => {
    if (net.ne < 1000) return { status: 'fail', detail: `only ${net.ne} edges` };
    if (state && state.net.edges !== net.ne) return { status: 'warn', detail: `state has ${state.net.edges} edges, map has ${net.ne}` };
    const seen = new Uint8Array(net.nn), q = [net.map.hubs[0].node]; seen[q[0]] = 1;
    for (let i = 0; i < q.length; i++) for (let k = net.off[q[i]]; k < net.off[q[i] + 1]; k++) { const v = net.to[k]; if (!seen[v]) { seen[v] = 1; q.push(v); } }
    const lost = net.map.hubs.filter((h) => !seen[h.node]).map((h) => h.n);
    return lost.length ? { status: 'fail', detail: `hubs unreachable: ${lost.join(', ')}` } : { detail: `${net.ne} edges, ${net.map.hubs.length} hubs connected, ${mapVersion(net)}` };
  });
  await add('clock', 'Clock skew', async () => {
    if (!timeSource) return { status: 'warn', detail: 'no reference time source configured' };
    const skew = Math.abs((await timeSource()) - clock.now());
    return skew > 30000 ? { status: 'fail', detail: `${Math.round(skew / 1000)} s skew` } : skew > 5000 ? { status: 'warn', detail: `${Math.round(skew / 1000)} s skew` } : { detail: `${Math.round(skew)} ms skew` };
  });
  const doc = { at: now, results };
  await store.set('checks', 'latest', doc).catch(() => {});
  return doc;
}
