// Pure analytics over the routable network (no DOM, no /vendor imports) so it is unit-testable in Node.
// `net` is the object returned by createNetwork() in @blr/model.

export const REGIONS = ['North', 'East', 'Central', 'West', 'South'];
export const REGION_INDEX = { North: 0, East: 1, Central: 2, West: 3, South: 4 };
export const CLASS_NAMES = ['arterial', 'subArterial', 'collector'];

/** v/c -> colour bucket 0..5 (matches --c0..--c5). */
export const colourClass = (vc) => (vc < 0.5 ? 0 : vc < 0.75 ? 1 : vc < 0.95 ? 2 : vc < 1.15 ? 3 : vc < 1.5 ? 4 : 5);
/** speed -> shading colour bucket for the territory "speed" layer (0 worst .. 4 best), null when unknown. */
export const speedBucket = (v) => (v == null ? null : v < 14 ? 0 : v < 20 ? 1 : v < 27 ? 2 : v < 34 ? 3 : 4);

/**
 * Per-station / per-region / city summary from a v/c + speed pair. The wire format has no flows, so flow is
 * reconstructed as vc x class capacity (exact except where an incident/works reduced capacity).
 */
export function summarizeApprox(net, vc, spd) {
  const ns = net.map.st.length, per = Array.from({ length: ns }, () => ({ vk: 0, sp: 0, L: 0, c: 0 }));
  for (let e = 0; e < net.ne; e++) {
    const l = net.len[e] / 1000, w = vc[e] * net.cap[e] * l, P = per[net.stn[e]];
    P.vk += w; P.sp += w * spd[e]; P.L += l; if (vc[e] > 0.95) P.c += l;
  }
  const agg = () => ({ vk: 0, sp: 0, L: 0, c: 0 }), city = agg(), reg = {};
  for (const r of REGIONS) reg[r] = agg();
  per.forEach((p, i) => { for (const A of [city, reg[net.map.st[i].r]]) { A.vk += p.vk; A.sp += p.sp; A.L += p.L; A.c += p.c; } });
  const fin = (p) => ({ speed: p.vk ? p.sp / p.vk : null, congPct: p.L ? (100 * p.c) / p.L : 0, km: p.L });
  return { city: fin(city), reg: Object.fromEntries(REGIONS.map((r) => [r, fin(reg[r])])), per: per.map(fin) };
}
export const scopeSum = (sum, scope) => (!sum ? null : scope === 'All' ? sum.city : sum.reg[scope]);

/** Busiest named roads (grouped by road name + station), by max v/c. `filter(stIdx)` limits stations. */
export function topRoads(net, vc, spd, { stn = null, filter = () => true, n = 8, minLen = 600 } = {}) {
  const m = new Map();
  for (let e = 0; e < net.ne; e++) {
    const nm = net.name[e]; if (nm < 0) continue;
    const s = net.stn[e]; if (stn != null ? s !== stn : !filter(s)) continue;
    const k = nm * 1000 + s; let o = m.get(k);
    if (!o) m.set(k, (o = { nameIdx: nm, stn: s, L: 0, mx: -1, e }));
    o.L += net.len[e]; if (vc[e] > o.mx) { o.mx = vc[e]; o.e = e; }
  }
  return [...m.values()].filter((o) => o.L > minLen).sort((a, b) => b.mx - a.mx).slice(0, n).map((o) => ({ ...o, speed: spd[o.e], vc: o.mx }));
}

/** Least-loaded different-named road touching either end of edge `e`; the "divert via" hint. */
export function nearestAlternate(net, vc, e) {
  // Prefer arterial / sub-arterial roads that carry some modelled traffic; fall back to any named road.
  let best = -1, bv = 9, tier = 9;
  for (const nd of [net.a[e], net.b[e]]) {
    for (let q = net.off[nd]; q < net.off[nd + 1]; q++) {
      const e2 = net.arc[q] >> 1;
      if (e2 === e || net.name[e2] === net.name[e] || net.name[e2] < 0) continue;
      const v = vc ? vc[e2] : 1, tr = net.cls[e2] <= 1 && v > 0.03 ? 0 : 1;
      if (tr < tier || (tr === tier && v < bv)) { tier = tr; bv = v; best = e2; }
    }
  }
  return best < 0 ? null : { e: best, vc: bv, nameIdx: net.name[best] };
}

// ---- works & incidents -> capacity multipliers ----
const nameIdxCache = new WeakMap();
function nameIndex(net) {
  let m = nameIdxCache.get(net);
  if (!m) { m = new Map(); net.map.n.forEach((n, i) => { if (!m.has(n)) m.set(n, i); }); nameIdxCache.set(net, m); }
  return m;
}
const stIdxCache = new WeakMap();
export function stationIndex(net) {
  let m = stIdxCache.get(net);
  if (!m) { m = new Map(); net.map.st.forEach((s, i) => m.set(s.n, i)); stIdxCache.set(net, m); }
  return m;
}
/** Edges a works record occupies: all edges whose road name matches `road` inside the listed stations. */
export function worksEdges(net, w) {
  // A road name may be spelled several times in map.n (case variants): collect all indices.
  const out = [], stI = stationIndex(net), idx = nameIndex(net);
  const ni = idx.get(w.road); if (ni == null) return out;
  const variants = [ni];
  const low = String(w.road).toLowerCase();
  net.map.n.forEach((n, i) => { if (i !== ni && n.toLowerCase() === low) variants.push(i); });
  for (const v of variants) {
    const byStn = net.roads.get(v); if (!byStn) continue;
    for (const sn of w.stations ?? w.stns ?? []) { const si = stI.get(sn); if (si != null && byStn.has(si)) out.push(...byStn.get(si)); }
  }
  return out;
}
export function hoursOK(w, h) {
  if (!w.hours || w.hours === 'all') return true;
  const pk = (h >= 7.5 && h < 11) || (h >= 16.5 && h < 20.5);
  return w.hours === 'peak' ? pk : h >= 22 || h < 6;
}
export const worksActiveAt = (w, date, h) => w.active !== false && w.from <= date && date <= w.to && hoursOK(w, h);

/** Float32Array capacity multipliers (or null) from incidents active at hour h and works active at (date, h). */
export function capMulFor(net, { incidents = [], works = [], date, h, extra = [] }) {
  let cm = null; const m = () => (cm ??= new Float32Array(net.ne).fill(1));
  for (const x of incidents) if (x.sh <= h && h < x.eh && x.e >= 0 && x.e < net.ne) { const c = m(); c[x.e] = Math.min(c[x.e], x.cap); }
  for (const w of works) if (worksActiveAt(w, date, h)) { const c = m(); for (const e of worksEdges(net, w)) c[e] = Math.min(c[e], w.cap); }
  for (const x of extra) { const c = m(); for (const e of x.edges) c[e] = Math.min(c[e], x.cap); }
  return cm;
}
export function capKey(cm) {
  if (!cm) return '0'; const s = [];
  for (let i = 0; i < cm.length; i++) if (cm[i] < 1) s.push(`${i}:${cm[i].toFixed(2)}`);
  return s.join(',');
}

function nodeSet(net, w) { const s = new Set(); for (const e of worksEdges(net, w)) { s.add(net.a[e]); s.add(net.b[e]); } return s; }
/** Pairs of works that overlap in time and share a corridor node or a station. */
export function clashes(net, works) {
  const ws = works.filter((w) => w.active !== false && worksEdges(net, w).length), out = [];
  const sets = new Map(ws.map((w) => [w.id, nodeSet(net, w)]));
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const a = ws[i], b = ws[j];
    if (!(a.from <= b.to && b.from <= a.to)) continue;
    if ((a.hours === 'peak' && b.hours === 'night') || (a.hours === 'night' && b.hours === 'peak')) continue;
    const na = sets.get(a.id), nb = sets.get(b.id); let touch = false;
    for (const k of na) if (nb.has(k)) { touch = true; break; }
    const sh = (a.stations ?? []).filter((s) => (b.stations ?? []).includes(s));
    if (touch || sh.length) out.push({ a, b, kind: touch ? 'corridor' : 'station', stations: sh });
  }
  return out;
}

/** Advice for a quantified clash (numbers are veh-h/h deltas at the morning peak). */
export function clashAdvice(c, r) {
  const aFirst = r.A <= r.B, first = aFirst ? c.b : c.a, move = aFirst ? c.a : c.b;
  return { move, first, synergy: r.AB - r.A - r.B, solo: Math.max(r.A, r.B), together: r.AB };
}

/** Bounding box of draw polylines for a set of edges (map units). */
export function edgesBox(net, DB, es) {
  const b = [1e9, 1e9, -1e9, -1e9];
  for (const e of es) { const d = net.draw[e]; b[0] = Math.min(b[0], DB[4 * d]); b[1] = Math.min(b[1], DB[4 * d + 1]); b[2] = Math.max(b[2], DB[4 * d + 2]); b[3] = Math.max(b[3], DB[4 * d + 3]); }
  return b;
}

export const incidentActiveAt = (x, h) => x.sh <= h && h < x.eh;
