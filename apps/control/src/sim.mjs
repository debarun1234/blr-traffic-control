// In-browser model runner: Web Worker with a chunked main-thread fallback, an LRU cache and in-flight de-dup.
import { assign, summarize } from '/vendor/model.mjs';
import { capKey } from './analytics.mjs';

let worker = null, workerOK = false, net = null, seq = 0, onBusy = () => {};
const waiting = new Map(), cache = new Map(), inflight = new Map();
let busy = 0;
const setBusy = (d) => { busy += d; onBusy(busy); };

export function startSim(netObj, busyCb) {
  net = netObj; if (busyCb) onBusy = busyCb;
  try {
    worker = new Worker('/sim-worker.mjs', { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.ready) { workerOK = true; return; }
      if (m.fatal) { fail(); return; }
      const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id);
      m.ok ? w.resolve(m) : w.reject(new Error(m.error));
    };
    worker.onerror = () => fail();
  } catch { fail(); }
}
function fail() {
  if (worker) { try { worker.terminate(); } catch { /* ignore */ } }
  worker = null; workerOK = false;
  for (const [, w] of waiting) w.retry();
  waiting.clear();
}
export const usingWorker = () => !!worker;

function runMain(p) {
  return new Promise((resolve, reject) => setTimeout(() => {
    try {
      const r = assign(net, p), s = summarize(net, r);
      resolve({ vc: r.vc, spd: r.spd, flow: r.flow, cost: r.cost, speed: s.speed, congPct: s.congPct });
    } catch (e) { reject(e); }
  }, 12));
}
function runWorker(p) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, retry: () => runMain(p).then(resolve, reject) });
    worker.postMessage({ id, ...p });
  });
}

/** Run one assignment. Resolves with {vc,spd,flow,cost,speed,congPct}. Results are cached and shared. */
export function runAssign({ t, capMul = null, boost = 1, iters = 6 }) {
  const q = Math.round(t * 4) / 4, key = `${q}|${boost.toFixed(3)}|${iters}|${capKey(capMul)}`;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return Promise.resolve(v); }
  if (inflight.has(key)) return inflight.get(key);
  const p = { t: q, capMul, boost, iters };
  setBusy(1);
  const pr = (worker ? runWorker(p) : runMain(p)).then((r) => {
    r.key = key; cache.set(key, r); if (cache.size > 48) cache.delete(cache.keys().next().value); return r;
  }).finally(() => { inflight.delete(key); setBusy(-1); });
  inflight.set(key, pr);
  return pr;
}
export const simBusy = () => busy;
