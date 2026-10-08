// Central client state: a plain object + topic pub/sub (coalesced per microtask), selectors and replay logic.
import { istParts } from '/vendor/shared.mjs';
import { runAssign } from './sim.mjs';
import { summarizeApprox, capMulFor, incidentActiveAt } from './analytics.mjs';
import { debounce, lsGet, lsSet } from './util.mjs';
import { setI18nLang } from './i18n.mjs';

export const S = {
  cfg: null, api: null, auth: null, MD: null, me: null,
  lang: lsGet('blr-lang', 'en') === 'kn' ? 'kn' : 'en',
  scope: 'All', sel: null, tab: 'overview',
  layers: { cong: true, minor: true, stn: true, inc: true, works: true, shade: 'none', base: ['roadmap', 'hybrid'].includes(lsGet('blr-base', 'plain')) ? lsGet('blr-base', 'plain') : 'plain' },
  replay: null, replayBusy: false, replayRes: null,
  live: null, result: null, sum: null,
  incidents: [], works: [], actions: [], crash: null, quota: null,
  conn: { ok: true, lastOk: 0, fails: 0, loaded: false }, simBusy: 0, tl: new Array(24).fill(null), tlBoost: null,
  hover: null, mapMismatch: false,
};

setI18nLang(S.lang);

// ---- pub/sub ----
const subs = new Map(), pending = new Set(); let scheduled = false;
let collector = null;
export function on(topics, fn) {
  for (const t of [].concat(topics)) { if (!subs.has(t)) subs.set(t, new Set()); subs.get(t).add(fn); }
  const off = () => { for (const t of [].concat(topics)) subs.get(t)?.delete(fn); };
  collector?.push(off); return off;
}
/** Run fn and return a disposer that removes every subscription made inside it. */
export function collectSubs(fn) { const prev = collector, mine = (collector = []); try { fn(); } finally { collector = prev; } return () => mine.forEach((o) => o()); }
export function emit(...topics) {
  topics.forEach((t) => pending.add(t));
  if (scheduled) return; scheduled = true;
  queueMicrotask(() => {
    scheduled = false; const tp = [...pending]; pending.clear(); const done = new Set();
    for (const t of tp) for (const fn of subs.get(t) ?? []) if (!done.has(fn)) { done.add(fn); try { fn(tp); } catch (e) { console.error(e); } }
  });
}

// ---- selectors ----
export const can = (perm) => !!S.me?.permissions?.includes(perm);
export const lockedRegion = () => S.me?.lockedRegion ?? null;
export const isCmd = () => S.me?.role === 'admin' || S.me?.role === 'commissioner';
export const isAdmin = () => S.me?.role === 'admin';
export const myStation = () => (S.me?.role === 'station' && S.MD ? S.MD.stIdx.get(S.me.station) ?? -1 : -1);
export const canActOn = (stIdx) => !!S.me && stIdx >= 0 && S.me.jurisdiction.includes(S.MD.ST[stIdx].n);
export const inScope = (region) => S.scope === 'All' || region === S.scope;
export const curHour = () => (S.replay != null ? S.replay : istParts().h);
export const today = () => S.live?.date ?? istParts().date;
export const fatal2025 = (i) => S.crash?.stations?.[S.MD.ST[i].n]?.y2025?.fatal ?? S.MD.ST[i].f;
export const nonfatal2025 = (i) => S.crash?.stations?.[S.MD.ST[i].n]?.y2025?.nonfatal ?? S.MD.ST[i].t;
export const crashHist = (i) => S.crash?.stations?.[S.MD.ST[i].n]?.hist ?? null;
export const scopeStations = () => S.MD.ST.filter((s) => inScope(s.r));

export function normIncident(i) {
  const MD = S.MD;
  const st = typeof i.station === 'number' ? i.station : MD.stIdx.get(i.station) ?? (i.edge >= 0 ? MD.net.stn[i.edge] : -1);
  return { id: String(i.id), type: i.type, e: i.edge, stn: st, sh: i.startHour, eh: i.endHour, cap: i.cap ?? 0.5, src: i.src ?? 'sim', by: i.by, note: i.note, date: i.date };
}
export function normAction(a) {
  const MD = S.MD, stn = MD.stIdx.get(a.station) ?? (a.edge >= 0 ? MD.net.stn[a.edge] : -1);
  return { ...a, e: a.edge, stn, region: a.region ?? MD.ST[stn]?.r };
}
export const isOpenState = (s) => s === 'new' || s === 'ack' || s === 'prog' || s === 'persist';
export const openActions = () => S.actions.filter((a) => isOpenState(a.state));

/** Incidents active at hour h (replay uses the day's list; live also trusts the server's active list). */
export function incidentsAt(h) {
  const m = new Map();
  for (const x of S.incidents) if (incidentActiveAt(x, h)) m.set(x.id, x);
  if (S.replay == null) for (const x of S.live?.incidents ?? []) if (!m.has(x.id)) m.set(x.id, x);
  return [...m.values()].filter((x) => x.e >= 0 && x.e < S.MD.net.ne);
}
export function allIncidentsToday() {
  const m = new Map(S.incidents.map((x) => [x.id, x]));
  for (const x of S.live?.incidents ?? []) if (!m.has(x.id)) m.set(x.id, x);
  return [...m.values()];
}

// ---- view setters ----
export function setScope(s) {
  const lr = lockedRegion(); if (lr) s = lr;
  S.scope = s; S.sel = null; emit('view', 'scope', 'result');
}
export function setSel(sel) { S.sel = sel; emit('view', 'sel'); }
export function setTab(t) { S.tab = t; emit('view', 'tab'); }
export function setLang(l) { S.lang = l; setI18nLang(l); lsSet('blr-lang', l); document.documentElement.lang = l === 'kn' ? 'kn' : 'en'; document.body.classList.toggle('kn', l === 'kn'); emit('lang', 'view'); }

// ---- result (what the map and KPIs show) ----
export function applyResult() {
  const L = S.live, net = S.MD.net;
  let r = null;
  if (S.replay == null) { if (L?.vc && !S.mapMismatch) r = { kind: 'live', vc: L.vc, spd: L.spd, h: istParts().h }; }
  else if (S.replayRes) r = { kind: 'replay', vc: S.replayRes.vc, spd: S.replayRes.spd, h: S.replayRes.h, flow: S.replayRes.flow };
  S.result = r ?? (S.replay != null ? S.result : null);
  S.sum = S.result ? summarizeApprox(net, S.result.vc, S.result.spd) : null;
  emit('result');
}

let replayTok = 0;
const scheduleReplay = debounce(async () => {
  const h = S.replay; if (h == null) return;
  const tok = ++replayTok; S.replayBusy = true; emit('view');
  try {
    const net = S.MD.net;
    const capMul = capMulFor(net, { incidents: allIncidentsToday(), works: S.works, date: today(), h });
    const r = await runAssign({ t: h, capMul, boost: S.live?.boost ?? 1, iters: 5 });
    if (tok !== replayTok || S.replay == null) return;
    S.replayRes = { ...r, h }; applyResult();
  } catch (e) { console.error('replay failed', e); }
  finally { if (tok === replayTok) { S.replayBusy = false; emit('view'); } }
}, 180);

/** h: hour 0..24 (quarter-hour steps) or null for live. */
export function setReplay(h) {
  S.replay = h == null ? null : Math.max(0, Math.min(23.75, Math.round(h * 4) / 4));
  if (S.replay == null) { replayTok++; S.replayBusy = false; S.replayRes = null; scheduleReplay.cancel(); applyResult(); }
  else scheduleReplay();
  emit('view', 'replay');
}
export const refreshReplay = () => { if (S.replay != null) scheduleReplay(); };

// ---- typical-day timeline (model, no incidents/works) ----
let tlRun = 0;
export function startTimeline() {
  const boost = S.live?.boost ?? 1; if (S.tlBoost != null && Math.abs(S.tlBoost - boost) / boost < 0.08 && S.tl.every((v) => v != null)) return;
  S.tlBoost = boost; const run = ++tlRun; S.tl = new Array(24).fill(null);
  (async function next(h) {
    if (run !== tlRun || h >= 24) return;
    try { const r = await runAssign({ t: h, boost, iters: 4 }); if (run !== tlRun) return; S.tl[h] = r.speed; emit('tl'); } catch { /* ignore */ }
    setTimeout(() => next(h + 1), 120);
  })(0);
}
