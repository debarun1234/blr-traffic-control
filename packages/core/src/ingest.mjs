import { istParts } from '@blr/shared';
import { snapToEdge, stationName } from './map.mjs';
import { validateWork } from './csv.mjs';
import { capForType, round2 } from './incidents.mjs';
import { sha256 } from './util.mjs';

const EXT = /^[A-Za-z0-9._:-]{1,80}$/;
export const MAX_BATCH = 500;

/** Validate raw event objects. Returns {valid:[{externalId,doc}],rejected:[{index,reason}]} where doc lacks id/src/by/createdAt. */
export function validateEvents(net, events, now) {
  const { date, h } = istParts(now), valid = [], rejected = [];
  for (const [i, e] of events.entries()) {
    const bad = (reason) => rejected.push({ index: i, reason });
    if (!e || typeof e !== 'object') { bad('not an object'); continue; }
    if (!EXT.test(String(e.externalId ?? ''))) { bad('externalId must match [A-Za-z0-9._:-]{1,80}'); continue; }
    if (typeof e.type !== 'string' || !e.type.trim() || e.type.length > 60) { bad('type required (max 60)'); continue; }
    const dur = Number(e.durationMin); if (!(dur >= 5 && dur <= 720)) { bad('durationMin must be 5..720'); continue; }
    let edge;
    if (e.edge !== undefined && e.edge !== null && e.edge !== '') { edge = Number(e.edge); if (!Number.isInteger(edge) || edge < 0 || edge >= net.ne) { bad('edge out of range'); continue; } }
    else if (Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon)) && e.lat !== '' && e.lon !== '') { edge = snapToEdge(net, Number(e.lat), Number(e.lon), 150); if (edge === null) { bad('no routable edge within 150 m'); continue; } }
    else { bad('edge or lat+lon required'); continue; }
    let sh = h; if (e.startHour !== undefined && e.startHour !== null && e.startHour !== '') { sh = Number(e.startHour); if (!(sh >= 0 && sh < 24)) { bad('startHour must be 0..24'); continue; } }
    let cap = capForType(e.type); if (e.cap !== undefined && e.cap !== null && e.cap !== '') { cap = Number(e.cap); if (!(cap >= 0 && cap <= 1)) { bad('cap must be 0..1'); continue; } }
    valid.push({ externalId: e.externalId, doc: { type: e.type.trim(), edge, station: stationName(net, edge) ?? '', date, startHour: round2(sh), endHour: round2(sh + dur / 60), cap } });
  }
  return { valid, rejected };
}
/** Upsert validated events; returns counts. createdAt is preserved on re-delivery. */
export async function upsertEvents(store, valid, { idFor, src, by, connectorId, now }) {
  let updated = 0;
  for (const v of valid) {
    const id = idFor(v.externalId);
    await store.update('incidents', id, (cur) => { if (cur) updated++; return { id, src, ...v.doc, by, ...(connectorId ? { connectorId } : {}), createdAt: cur?.createdAt ?? now }; });
  }
  return { created: valid.length - updated, updated };
}
/** POST /ingest/v1/events. Idempotent on (key, externalId). */
export async function ingestEvents({ store, net, now }, keyDoc, events) {
  const { valid, rejected } = validateEvents(net, events, now);
  const r = await upsertEvents(store, valid, { idFor: (x) => `ing-${keyDoc.id}-${x}`, src: 'ingest', by: `key:${keyDoc.prefix}`, now });
  return { accepted: valid.length, ...r, rejected };
}

/** POST /ingest/v1/speeds */
export async function ingestSpeeds({ store, now }, observations) {
  const rejected = [], ops = [], probes = new Map();
  for (const [i, o] of observations.entries()) {
    const bad = (reason) => rejected.push({ index: i, reason });
    if (!o || typeof o.probeId !== 'string') { bad('probeId required'); continue; }
    const m = Number(o.minutes); if (!(m > 0.2 && m <= 600)) { bad('minutes must be 0.2..600'); continue; }
    const at = o.at === undefined ? now : Number(o.at);
    if (!Number.isFinite(at) || at > now + 300000 || at < now - 86400000) { bad('at must be within the last 24 h'); continue; }
    if (!probes.has(o.probeId)) probes.set(o.probeId, await store.get('probes', o.probeId));
    if (!probes.get(o.probeId)) { bad('unknown probeId'); continue; }
    const id = `${o.probeId}_${Math.round(at)}`;
    ops.push({ op: 'set', col: 'probe_obs', id, data: { id, probeId: o.probeId, at: Math.round(at), minutes: m, source: 'ingest', expireAt: now + 7 * 86400000 } });
  }
  for (let k = 0; k < ops.length; k += 400) await store.batch(ops.slice(k, k + 400));
  return { accepted: ops.length, rejected };
}

/** POST /ingest/v1/works */
export async function ingestWorks({ store, net, now }, keyDoc, works) {
  const rejected = [], ops = [];
  for (const [i, w] of works.entries()) {
    const v = validateWork(w ?? {}, net);
    if (!v.ok) { rejected.push({ index: i, reason: v.reason }); continue; }
    const id = `w-ing-${sha256(`${keyDoc.id}|${v.value.name}|${v.value.road}|${v.value.from}`).slice(0, 12)}`;
    ops.push({ id, value: v.value });
  }
  for (const o of ops) await store.update('works', o.id, (cur) => ({ ...o.value, id: o.id, source: 'ingest', active: cur?.active ?? true, by: `key:${keyDoc.prefix}`, createdAt: cur?.createdAt ?? now }));
  return { accepted: ops.length, rejected };
}
