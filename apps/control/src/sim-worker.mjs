// Module Web Worker: runs @blr/model assignments off the main thread.
import { createNetwork, assign, summarize } from '/vendor/model.mjs';
let net = null;
const ready = fetch('/assets/map.json').then((r) => r.json()).then((m) => { net = createNetwork(m); });
ready.then(() => postMessage({ ready: true }), (e) => postMessage({ fatal: String(e) }));
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    await ready;
    const r = assign(net, { t: m.t, capMul: m.capMul ?? null, boost: m.boost ?? 1, iters: m.iters ?? 6 });
    const s = summarize(net, r);
    postMessage({ id: m.id, ok: true, vc: r.vc, spd: r.spd, flow: r.flow, cost: r.cost, speed: s.speed, congPct: s.congPct }, [r.vc.buffer, r.spd.buffer, r.flow.buffer]);
  } catch (e) { postMessage({ id: m.id, ok: false, error: String(e?.message ?? e) }); }
};
