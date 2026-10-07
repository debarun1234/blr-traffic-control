/**
 * Traffic model on the real Bengaluru arterial graph.
 *
 * Method: static user-equilibrium assignment (method of successive averages) with BPR link-performance
 * functions over a gravity-model demand between 60 centroids (7 employment hubs + 53 station nodes).
 * Environment-neutral ES module: runs in Node (worker/API) and in the browser (what-if planner).
 *
 * This is a planning-grade model. It is NOT calibrated to observed travel times until `calibrate()` is fed
 * probe observations (see docs/model.md). Outputs must always be presented as modelled, never as sensor data.
 */

export const DEFAULTS = Object.freeze({ demand: 300000, iters: 6 });
const CAP = [4200, 2600, 1500]; // pcu/h per direction by road class (0 arterial, 1 sub-arterial, 2 collector)
const FF = [55, 40, 30]; // free-flow km/h by class

/** Demand profile over the day (hour 0..24), 1.0 ≈ AM peak. */
export function wt(t) {
  return Math.min(1.15, 0.28 + 0.62 * Math.exp(-(((t - 9) / 1.4) ** 2)) + 0.6 * Math.exp(-(((t - 18.5) / 1.6) ** 2)) + 0.22 * Math.exp(-(((t - 13) / 3) ** 2)));
}
/** Tidal direction factor: +1 morning (towards employment hubs), -1 evening. */
export function tide(t) {
  return Math.exp(-(((t - 9) / 1.8) ** 2)) - Math.exp(-(((t - 18.5) / 2) ** 2));
}

/** Build the routable network and centroid set from packages/mapdata/map.json. */
export function createNetwork(map, opts = {}) {
  const ne = map.r.length, nn = map.nn;
  const net = {
    nn, ne, map,
    demand: opts.demand ?? DEFAULTS.demand,
    a: new Int32Array(ne), b: new Int32Array(ne), len: new Float32Array(ne), cls: new Uint8Array(ne),
    name: new Int32Array(ne), stn: new Int16Array(ne), cap: new Float32Array(ne), t0: new Float32Array(ne), draw: new Int32Array(ne),
  };
  for (let i = 0; i < ne; i++) {
    const e = map.r[i];
    net.a[i] = e[0]; net.b[i] = e[1]; net.len[i] = e[2]; net.cls[i] = e[3]; net.stn[i] = e[4]; net.draw[i] = e[5];
    net.name[i] = map.d[e[5]][1];
    net.cap[i] = CAP[e[3]];
    net.t0[i] = Math.max(0.02, (e[2] / 1000 / FF[e[3]]) * 60); // minutes
  }
  const deg = new Int32Array(nn + 1);
  for (let i = 0; i < ne; i++) { deg[net.a[i] + 1]++; deg[net.b[i] + 1]++; }
  for (let i = 0; i < nn; i++) deg[i + 1] += deg[i];
  net.off = deg;
  const pos = deg.slice(0, nn);
  net.to = new Int32Array(2 * ne); net.arc = new Int32Array(2 * ne);
  for (let i = 0; i < ne; i++) {
    let p = pos[net.a[i]]++; net.to[p] = net.b[i]; net.arc[p] = 2 * i;
    p = pos[net.b[i]]++; net.to[p] = net.a[i]; net.arc[p] = 2 * i + 1;
  }
  net.cen = []; net.cw = []; net.cemp = []; net.cname = [];
  for (const h of map.hubs) { net.cen.push(h.node); net.cw.push(h.w * 3); net.cemp.push(h.w); net.cname.push(h.n); }
  for (const s of map.st) { net.cen.push(s.node); net.cw.push(1); net.cemp.push(0.25); net.cname.push(s.n); }
  const nc = net.nc = net.cen.length;
  net.W = new Float32Array(nc * nc);
  let sum = 0;
  for (let i = 0; i < nc; i++) for (let j = 0; j < nc; j++) {
    if (i === j) continue;
    const A = map.nxy[net.cen[i]], B = map.nxy[net.cen[j]];
    const d = (Math.hypot(A[0] - B[0], A[1] - B[1]) * 2.2) / 1000;
    const w = net.cw[i] * net.cw[j] * Math.exp(-d / 9) * (d > 1 ? 1 : 0.3);
    net.W[i * nc + j] = w; sum += w;
  }
  net.Wsum = sum;
  net._heapK = new Float64Array(2 * ne + nn + 8); net._heapV = new Int32Array(2 * ne + nn + 8);
  net._dist = new Float64Array(nn); net._pred = new Int32Array(nn);
  // road-name index: name -> station -> edges
  net.roads = new Map();
  for (let e = 0; e < ne; e++) {
    const n = net.name[e]; if (n < 0) continue;
    let m = net.roads.get(n); if (!m) net.roads.set(n, (m = new Map()));
    let l = m.get(net.stn[e]); if (!l) m.set(net.stn[e], (l = []));
    l.push(e);
  }
  return net;
}

function demandMatrix(net, t, boost) {
  const nc = net.nc, D = new Float32Array(nc * nc), T = (net.demand * wt(t) * boost) / net.Wsum, tau = tide(t);
  for (let i = 0; i < nc; i++) for (let j = 0; j < nc; j++) {
    const w = net.W[i * nc + j]; if (!w) continue;
    const ei = net.cemp[i], ej = net.cemp[j];
    D[i * nc + j] = w * T * (1 + 0.45 * tau * (ej - ei) / (ej + ei));
  }
  return D;
}

function sssp(net, src, tm) {
  const K = net._heapK, V = net._heapV, dist = net._dist, pred = net._pred;
  let n = 0; dist.fill(1e18); pred.fill(-1); dist[src] = 0;
  const push = (k, v) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = k; V[i] = v; };
  push(0, src);
  while (n > 0) {
    const k = K[0], u = V[0]; n--;
    if (n > 0) { const lk = K[n], lv = V[n]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; } K[i] = lk; V[i] = lv; }
    if (k > dist[u]) continue;
    for (let q = net.off[u]; q < net.off[u + 1]; q++) {
      const arc = net.arc[q], w = tm[arc]; if (w >= 1e9) continue;
      const nd = k + w, v = net.to[q];
      if (nd < dist[v]) { dist[v] = nd; pred[v] = arc; push(nd, v); }
    }
  }
}

function aon(net, D, tm, flow) {
  const { nn, nc } = net, sub = new Float64Array(nn), dist = net._dist, pred = net._pred;
  for (let i = 0; i < nc; i++) {
    let any = false; for (let j = 0; j < nc; j++) if (D[i * nc + j] > 0) { any = true; break; }
    if (!any) continue;
    sssp(net, net.cen[i], tm);
    sub.fill(0);
    for (let j = 0; j < nc; j++) { const d = D[i * nc + j]; if (d > 0 && dist[net.cen[j]] < 1e17) sub[net.cen[j]] += d; }
    const order = []; for (let v = 0; v < nn; v++) if (pred[v] >= 0) order.push(v);
    order.sort((x, y) => dist[y] - dist[x]);
    for (const v of order) { const arc = pred[v], e = arc >> 1, u = arc & 1 ? net.b[e] : net.a[e]; flow[arc] += sub[v]; sub[u] += sub[v]; }
  }
}

function arcTimes(net, flow, capMul) {
  const tm = new Float32Array(2 * net.ne);
  for (let i = 0; i < net.ne; i++) {
    const c = net.cap[i] * (capMul ? capMul[i] : 1);
    if (c <= 0) { tm[2 * i] = tm[2 * i + 1] = 1e9; continue; }
    for (let s = 0; s < 2; s++) { const x = Math.min(2, flow[2 * i + s] / c); tm[2 * i + s] = net.t0[i] * (1 + 0.15 * x ** 4); }
  }
  return tm;
}

/**
 * Assign demand at hour `t`.
 * @param {object} net from createNetwork
 * @param {{t:number, capMul?:Float32Array|null, boost?:number, iters?:number}} p
 * @returns {{flow:Float32Array, vc:Float32Array, spd:Float32Array, tm:Float32Array, cost:number, t:number, boost:number}}
 */
export function assign(net, { t, capMul = null, boost = 1, iters = DEFAULTS.iters }) {
  const D = demandMatrix(net, t, boost), na = 2 * net.ne;
  const flow = new Float32Array(na);
  let tm = arcTimes(net, flow, capMul); aon(net, D, tm, flow);
  for (let it = 2; it <= iters; it++) {
    tm = arcTimes(net, flow, capMul);
    const aux = new Float32Array(na); aon(net, D, tm, aux);
    const l = 1 / it; for (let k = 0; k < na; k++) flow[k] += l * (aux[k] - flow[k]);
  }
  tm = arcTimes(net, flow, capMul);
  const vc = new Float32Array(net.ne), spd = new Float32Array(net.ne); let cost = 0;
  for (let i = 0; i < net.ne; i++) {
    const c = net.cap[i] * (capMul ? capMul[i] : 1), f = Math.max(flow[2 * i], flow[2 * i + 1]);
    vc[i] = c > 0 ? f / c : 9;
    const tt = Math.max(tm[2 * i], tm[2 * i + 1]);
    spd[i] = c > 0 ? net.len[i] / 1000 / (tt / 60) : 0;
    cost += flow[2 * i] * tm[2 * i] + flow[2 * i + 1] * tm[2 * i + 1];
  }
  return { flow, vc, spd, tm, cost: cost / 60, t, boost };
}

/** Flow-weighted city/station summary. `scope(stationIdx)` optionally filters. */
export function summarize(net, res, scope = () => true) {
  const ns = net.map.st.length, per = Array.from({ length: ns }, () => ({ vk: 0, sp: 0, L: 0, c: 0 }));
  let vk = 0, vs = 0, L = 0, cl = 0;
  for (let e = 0; e < net.ne; e++) {
    const s = net.stn[e], f = Math.max(res.flow[2 * e], res.flow[2 * e + 1]), l = net.len[e] / 1000, w = f * l, P = per[s];
    P.vk += w; P.sp += w * res.spd[e]; P.L += l; if (res.vc[e] > 0.95) P.c += l;
    if (!scope(s)) continue;
    vk += w; vs += w * res.spd[e]; L += l; if (res.vc[e] > 0.95) cl += l;
  }
  return {
    speed: vk ? vs / vk : 0, congPct: L ? (100 * cl) / L : 0,
    per: per.map((p) => ({ speed: p.vk ? p.sp / p.vk : null, cong: p.L ? (100 * p.c) / p.L : 0, km: p.L })),
  };
}

/** Shortest travel time (minutes) between two nodes under result times. */
export function pathMinutes(net, res, fromNode, toNode) {
  sssp(net, fromNode, res.tm);
  return net._dist[toNode] < 1e17 ? net._dist[toNode] : null;
}

/**
 * Calibrate demand scale so modelled corridor travel times match observations.
 * @param probes [{from:node, to:node, observedMin:number, freeMin:number}]
 * Returns {boost, fit:[{modelled, observed}], rmsePct}. Uses bisection on the demand multiplier.
 */
export function calibrate(net, t, probes, { capMul = null, lo = 0.3, hi = 3, steps = 7 } = {}) {
  if (!probes.length) return { boost: 1, fit: [], rmsePct: null };
  const err = (boost) => {
    const r = assign(net, { t, capMul, boost, iters: 4 });
    let s = 0; for (const p of probes) { const m = pathMinutes(net, r, p.from, p.to); s += (m ?? p.freeMin) / p.observedMin - 1; }
    return s / probes.length;
  };
  let a = lo, b = hi;
  for (let i = 0; i < steps; i++) { const mid = (a + b) / 2; if (err(mid) > 0) b = mid; else a = mid; }
  const boost = (a + b) / 2, r = assign(net, { t, capMul, boost, iters: 4 });
  const fit = probes.map((p) => ({ modelled: pathMinutes(net, r, p.from, p.to), observed: p.observedMin }));
  const rmse = Math.sqrt(fit.reduce((s, f) => s + ((f.modelled / f.observed) - 1) ** 2, 0) / fit.length) * 100;
  return { boost, fit, rmsePct: rmse };
}

/** Compact wire format: vc*100 and speed km/h as base64 uint8 arrays (one byte per edge). */
export function encodeState(res) {
  const n = res.vc.length, vc = new Uint8Array(n), sp = new Uint8Array(n);
  for (let i = 0; i < n; i++) { vc[i] = Math.min(255, Math.round(res.vc[i] * 100)); sp[i] = Math.min(255, Math.round(res.spd[i])); }
  return { vc: b64(vc), spd: b64(sp), n };
}
export function decodeState(enc) {
  const vc = unb64(enc.vc), sp = unb64(enc.spd), n = enc.n;
  const out = { vc: new Float32Array(n), spd: new Float32Array(n) };
  for (let i = 0; i < n; i++) { out.vc[i] = vc[i] / 100; out.spd[i] = sp[i]; }
  return out;
}
function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}

// ---- deterministic simulated incidents (used only when feed mode = "simulated") ----
export function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const INCIDENT_TYPES = Object.freeze([
  { type: 'Vehicle breakdown', cap: 0.55 }, { type: 'Accident', cap: 0.4 }, { type: 'Waterlogging', cap: 0.45 },
  { type: 'Procession', cap: 0.5 }, { type: 'Signal fault', cap: 0.7 }, { type: 'Tree fall', cap: 0.35 },
]);
/** @returns {{id:string,type:string,e:number,sh:number,eh:number,cap:number,stn:number,src:'sim'}[]} */
export function simIncidents(net, dateIso, count = 18) {
  const elig = []; for (let e = 0; e < net.ne; e++) if (net.name[e] >= 0 && (net.cls[e] <= 1 || (net.cls[e] === 2 && e % 3 === 0))) elig.push(e);
  const r = rng(hash32(dateIso)), out = [];
  for (let k = 0; k < count; k++) {
    const p = r(); const h = p < 0.5 ? 7.5 + r() * 3.5 : p < 0.85 ? 16.5 + r() * 4 : 6 + r() * 16;
    const it = INCIDENT_TYPES[Math.floor(r() * INCIDENT_TYPES.length)], d = 25 + Math.floor(r() * 50), e = elig[Math.floor(r() * elig.length)];
    out.push({ id: `${dateIso}-${k}`, type: it.type, e, sh: h, eh: h + d / 60, cap: it.cap, stn: net.stn[e], src: 'sim' });
  }
  return out;
}
