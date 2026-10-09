import { decodeState } from '@blr/model';
import { roadName, stationName, stationRegion } from '../map.mjs';
import { detourAround } from './graph.mjs';
import { fmtHour } from '../incidents.mjs';

const r2 = (x) => Math.round(x * 100) / 100;
const PEAKS = [[7, 11], [16, 21]];
/** Where `hour` sits against the demand peaks, as a short phrase the model can quote. */
export function peakInfo(hour) {
  if (!Number.isFinite(hour)) return null;
  for (const [a, b] of PEAKS) if (hour >= a && hour < b) return `in a demand peak until ${fmtHour(b)}`;
  const next = PEAKS.map(([a]) => (a > hour ? a - hour : a + 24 - hour)).reduce((m, x) => Math.min(m, x), 99), start = PEAKS.find(([a]) => (a > hour ? a - hour : a + 24 - hour) === next)?.[0];
  return `next demand peak starts ${fmtHour(start)} (in about ${Math.round(next)} h)`;
}
/** Server-side context for action advice. Numbers come from the stored state, never from the client. */
export function actionContext({ net, state, action, incident, question }) {
  const e = action.edge, ok = Number.isInteger(e) && e >= 0 && e < net.ne;
  let vc = null, speed = null;
  if (ok && state?.vc) { const d = decodeState({ vc: state.vc, spd: state.spd, n: net.ne }); vc = r2(d.vc[e]); speed = Math.round(d.spd[e]); }
  const alt = ok ? detourAround(net, e) : null;
  return {
    type: action.type, title: action.title, road: ok ? roadName(net, e) : null, station: action.station, region: action.region, pri: action.pri,
    incType: incident?.type ?? undefined, cap: incident?.cap, endHour: incident?.endHour, vc, speed, hour: state?.hour,
    alternates: alt ? { roads: alt.roads, extraKm: r2(alt.extraM / 1000) } : null,
    simulated: incident ? incident.src === 'sim' : state?.mode !== 'live', mode: state?.mode, ...(question ? { question } : {}),
    ageMin: Number.isFinite(action.raisedAt) && state?.updatedAt ? Math.max(0, Math.round((state.updatedAt - action.raisedAt) / 60000)) : undefined,
    escalated: !!action.escalated, wf: action.state, peak: peakInfo(state?.hour),
    ...(() => { const i = net.map.st.findIndex((s) => s.n === action.station), s = i >= 0 ? state?.stations?.find((x) => x.i === i) : null; return s ? { stnSpeed: s.speed ?? undefined, stnCong: s.cong ?? undefined } : {}; })(),
  };
}
/** Aggregate (non-personal) facts for the brief. */
export function briefContext({ net, state, actions = [], scope }) {
  const regionOf = (si) => net.map.st[si]?.r, inScope = (si) => scope === 'city' || regionOf(si) === scope || (scope === 'Urban' && regionOf(si) !== 'Rural');
  const d = decodeState({ vc: state.vc, spd: state.spd, n: net.ne });
  const worst = new Map();
  for (let e = 0; e < net.ne; e++) {
    if (net.name[e] < 0 || !inScope(net.stn[e]) || d.vc[e] < 0.9) continue;
    const k = `${net.name[e]}|${net.stn[e]}`; if (!worst.has(k) || d.vc[e] > worst.get(k).vc) worst.set(k, { road: roadName(net, e), station: stationName(net, e), vc: r2(d.vc[e]) });
  }
  const sts = state.stations.filter((s) => inScope(s.i) && s.speed != null);
  const avg = (f) => (sts.length ? r2(sts.reduce((a, s) => a + s[f], 0) / sts.length) : null);
  const scoped = actions.filter((a) => scope === 'city' || a.region === scope || (scope === 'Urban' && a.region !== 'Rural'));
  const byRegion = new Map(); for (const s of sts) { const r = regionOf(s.i); const g = byRegion.get(r) ?? { n: 0, speed: 0, cong: 0 }; g.n++; g.speed += s.speed; g.cong += s.cong; byRegion.set(r, g); }
  const regions = [...byRegion].map(([region, g]) => ({ region, speedKmh: r2(g.speed / g.n), congestedPct: r2(g.cong / g.n) })).sort((a, b) => a.speedKmh - b.speedKmh);
  const now = state.updatedAt ?? state.t;
  const incidents = state.incidents.filter((i) => inScope(i.station)).slice(0, 6).map((i) => ({ type: i.type, road: roadName(net, i.edge), station: stationName(net, i.edge), capacityPct: Math.round(i.cap * 100), until: fmtHour(i.endHour) }));
  const works = state.works.slice(0, 4).map((w) => ({ name: w.name, road: w.road, capacityPct: Math.round(w.cap * 100) }));
  const escalatedTop = scoped.filter((a) => a.escalated && ['new', 'ack'].includes(a.state)).sort((a, b) => a.raisedAt - b.raisedAt).slice(0, 5).map((a) => ({ title: a.title, station: a.station, region: a.region, pri: a.pri, waitingMin: Number.isFinite(now) ? Math.max(0, Math.round((now - a.raisedAt) / 60000)) : undefined }));
  return {
    scope, hour: fmtHour(state.hour), date: state.date, mode: state.mode, simulated: state.mode !== 'live', stale: !!state.stale,
    avgSpeedKmh: scope === 'city' ? state.city.speed : avg('speed'), congestedPct: scope === 'city' ? state.city.congPct : avg('cong'),
    activeIncidents: state.incidents.filter((i) => inScope(i.station)).length, activeWorks: state.works.length,
    openActions: scoped.filter((a) => ['new', 'ack', 'prog', 'persist'].includes(a.state)).length, escalated: scoped.filter((a) => a.escalated && a.state === 'new').length,
    topCongested: [...worst.values()].sort((a, b) => b.vc - a.vc).slice(0, 5),
    regions, incidents, works, escalatedTop, peak: peakInfo(state.hour),
  };
}
export { stationRegion };
