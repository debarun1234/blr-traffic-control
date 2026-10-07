import { INCIDENT_TYPES, simIncidents } from '@blr/model';
import { actionIdFor } from '@blr/shared';
import { roadName, stationName, stationRegion } from './map.mjs';
import { clamp } from './util.mjs';

export const MIN_CAP = 0.05;
export const capForType = (type) => INCIDENT_TYPES.find((t) => t.type.toLowerCase() === String(type).toLowerCase())?.cap ?? 0.5;

/** Does an incident cover (date, hour h)? Handles incidents running past midnight (endHour > 24). */
export function incidentActive(i, date, h, yesterday) {
  if (i.date === date) return i.startHour <= h && h < i.endHour;
  if (i.date === yesterday) return i.startHour <= h + 24 && h + 24 < i.endHour;
  return false;
}
/** Simulated incidents mapped to the incident doc shape (never stored). */
export function simIncidentDocs(net, date) {
  return simIncidents(net, date).map((s) => ({ id: s.id, src: 'sim', type: s.type, edge: s.e, station: net.map.st[s.stn]?.n ?? '', date, startHour: round2(s.sh), endHour: round2(s.eh), cap: s.cap, createdAt: 0 }));
}
export const round2 = (x) => Math.round(x * 100) / 100;

/** Action for an incident (deterministic id). `vc0` = V/C on the edge at raise time if known. */
export function buildIncidentAction(net, inc, { now, hour, vc0, note } = {}) {
  const road = roadName(net, inc.edge) ?? 'unnamed road';
  const station = inc.station || stationName(net, inc.edge) || '';
  const a = {
    id: actionIdFor(inc.id), incidentId: inc.id, type: 'inc', edge: inc.edge, station, region: stationRegion(net, station) ?? '',
    title: `${inc.type} on ${road}`,
    detail: `${inc.type} on ${road} (${station}); modelled capacity ${Math.round(inc.cap * 100)}% until ${fmtHour(inc.endHour)}.${note ? ' Note: ' + String(note).slice(0, 200) : ''}`,
    pri: inc.cap <= 0.5 ? 'hi' : 'md', state: 'new', raisedAt: now, raisedHour: round2(hour), escalated: false, date: inc.date,
  };
  if (vc0 !== undefined) a.vc0 = vc0;
  return a;
}
export const fmtHour = (h) => { const hh = Math.floor(h % 24), mm = Math.round((h % 1) * 60); return `${String(hh).padStart(2, '0')}:${String(mm === 60 ? 59 : mm).padStart(2, '0')}`; };
/** Public incident view for GET /api/incidents is the doc itself. */
export const clampCap = (c) => clamp(c, MIN_CAP, 1);
