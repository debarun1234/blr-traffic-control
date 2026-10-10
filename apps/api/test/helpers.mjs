import { createMemoryStore, fixedClock, getNet, createAiRouter, runTick } from '@blr/core';
import { buildServer } from '../src/server.mjs';

export const net = getNet();
/** 2026-10-07 09:00 IST */
export const T0 = Date.parse('2026-10-07T03:30:00Z');
export const USERS = {
  admin: { role: 'admin' }, commissioner: { role: 'commissioner' }, 'north.dcp': { role: 'dcp', region: 'North' }, 'south.dcp': { role: 'dcp', region: 'South' },
  yelahanka: { role: 'station', station: 'Yelahanka' }, indiranagar: { role: 'station', station: 'Indiranagar' }, viewer: { role: 'viewer' }, gone: { role: 'admin', active: false },
};
export const em = (k) => `${k}@example.test`;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
export { json };

/** Build a server on a memory store with seeded users, a fixed clock and (optionally) one real tick. */
export async function makeApp({ tick = true, generate, fetch, serverOpts = {}, env = {} } = {}) {
  const store = createMemoryStore(), clock = fixedClock(T0), calls = [];
  for (const [k, v] of Object.entries(USERS)) await store.set('users', em(k), { email: em(k), name: k, active: true, createdBy: 'test', createdAt: 1, ...v });
  const gen = generate ?? (async (o) => { calls.push(o); return { text: `AI[${o.model}] ok. ` + "Hold traffic at the upstream junction and clear the lane before the next peak builds. ".repeat(5), tokensIn: 100, tokensOut: 50 }; });
  const ai = createAiRouter({ store, clock, generate: gen });
  const app = await buildServer({ store, clock, ai, net, logger: false, fetch, resolve: async () => ['93.184.216.34'], secretReader: async () => 'k', env: { AUTH_MODE: 'dev', NODE_ENV: 'test', ...env }, ...serverOpts });
  if (tick) await runTick({ store, net, now: clock.now() });
  /** @returns {Promise<{status:number, body:any, headers:object, text:string}>} */
  const call = async (who, method, url, payload, headers = {}) => {
    const h = { ...(who ? { 'x-dev-user': who.includes('@') ? who : em(who) } : {}), ...headers };
    let body = payload; if (payload !== undefined && typeof payload !== 'string') { body = JSON.stringify(payload); h['content-type'] ??= 'application/json'; }
    const r = await app.inject({ method, url, payload: body, headers: h });
    let parsed; try { parsed = r.body ? JSON.parse(r.body) : undefined; } catch { parsed = undefined; }
    return { status: r.statusCode, body: parsed, headers: r.headers, text: r.body };
  };
  return { app, store, clock, ai, call, calls };
}
/** First edge of a named road in a given station (for station-scoped tests). */
export function edgeIn(stationName) {
  const si = net.map.st.findIndex((s) => s.n === stationName);
  for (let e = 0; e < net.ne; e++) if (net.stn[e] === si && net.name[e] >= 0) return e;
  throw new Error('no edge in ' + stationName);
}
