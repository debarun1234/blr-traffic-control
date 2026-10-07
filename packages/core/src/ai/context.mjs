import { decodeState } from '@blr/model';
import { roadName, stationName, stationRegion } from '../map.mjs';
import { detourAround } from './graph.mjs';
import { fmtHour } from '../incidents.mjs';

const r2 = (x) => Math.round(x * 100) / 100;
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
  };
}
/** Aggregate (non-personal) facts for the brief. */
export function briefContext({ net, state, actions = [], scope }) {
  const regionOf = (si) => net.map.st[si]?.r, inScope = (si) => scope === 'city' || regionOf(si) === scope;
  const d = decodeState({ vc: state.vc, spd: state.spd, n: net.ne });
  const worst = new Map();
  for (let e = 0; e < net.ne; e++) {
    if (net.name[e] < 0 || !inScope(net.stn[e]) || d.vc[e] < 0.9) continue;
    const k = `${net.name[e]}|${net.stn[e]}`; if (!worst.has(k) || d.vc[e] > worst.get(k).vc) worst.set(k, { road: roadName(net, e), station: stationName(net, e), vc: r2(d.vc[e]) });
  }
  const sts = state.stations.filter((s) => inScope(s.i) && s.speed != null);
  const avg = (f) => (sts.length ? r2(sts.reduce((a, s) => a + s[f], 0) / sts.length) : null);
  const scoped = actions.filter((a) => scope === 'city' || a.region === scope);
  return {
    scope, hour: fmtHour(state.hour), date: state.date, mode: state.mode, simulated: state.mode !== 'live', stale: !!state.stale,
    avgSpeedKmh: scope === 'city' ? state.city.speed : avg('speed'), congestedPct: scope === 'city' ? state.city.congPct : avg('cong'),
    activeIncidents: state.incidents.filter((i) => inScope(i.station)).length, activeWorks: state.works.length,
    openActions: scoped.filter((a) => ['new', 'ack', 'prog', 'persist'].includes(a.state)).length, escalated: scoped.filter((a) => a.escalated && a.state === 'new').length,
    topCongested: [...worst.values()].sort((a, b) => b.vc - a.vc).slice(0, 5),
  };
}
export { stationRegion };
