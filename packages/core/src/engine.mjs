import { assign, summarize, encodeState, calibrate, hash32 } from '@blr/model';
import { istParts, actionIdFor, canonStation } from '@blr/shared';
import { getSettings } from './settings.mjs';
import { shiftDate, istMinuteKey, clamp } from './util.mjs';
import { roadName, stationName, stationRegion } from './map.mjs';
import { simIncidentDocs, incidentActive, buildIncidentAction, clampCap, round2 } from './incidents.mjs';
import { createAudit } from './audit.mjs';
import { PAID } from './connectors/types.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
export const BOOST_MIN = 0.5, BOOST_MAX = 2, MIN_FRESH_OBS = 3, MAX_CONG_ACTIONS = 20;
const mapVersions = new WeakMap();
export function mapVersion(net) {
  let v = mapVersions.get(net);
  if (!v) mapVersions.set(net, (v = `${net.ne}e-${net.nn}n-${hash32(net.map.n.join('|')).toString(16)}`));
  return v;
}
const nameIndex = new WeakMap();
function roadIdx(net, road) {
  let m = nameIndex.get(net);
  if (!m) { m = new Map(); net.map.n.forEach((n, i) => m.set(n.toLowerCase(), i)); nameIndex.set(net, m); }
  return m.get(String(road).trim().toLowerCase());
}
/** Edges of a named road within the given stations (all stations if list empty). */
export function worksEdges(net, w) {
  const idx = roadIdx(net, w.road); if (idx === undefined) return [];
  const byStn = net.roads.get(idx); if (!byStn) return [];
  const want = (w.stations ?? []).length ? new Set(w.stations.map(canonStation)) : null, out = [];
  for (const [si, edges] of byStn) if (!want || want.has(net.map.st[si]?.n)) out.push(...edges);
  return out;
}
export function workActive(w, date, h) {
  if (w.active === false || w.illustrative === true || w.source === 'seed') return false;
  if (w.from > date || w.to < date) return false;
  return w.hours === 'peak' ? (h >= 7 && h < 11) || (h >= 16 && h < 21) : w.hours === 'night' ? h >= 22 || h < 6 : true;
}

/**
 * One feed tick. Pure of wall-clock: everything derives from `now`.
 * @param {{store:any, net:any, now:number, connectors?:{runDue(o:{now:number}):Promise<any>}, settings?:any}} p
 */
export async function runTick({ store, net, now, connectors, settings, idle = false }) {
  const started = performance.now();
  settings ??= await getSettings(store);
  const audit = createAudit({ store, clock: { now: () => now } });
  const { date, h } = istParts(now), yesterday = shiftDate(date, -1), mode = settings.feed.mode;

  const connectorRuns = connectors?.runDue ? await connectors.runDue({ now, skipPaid: idle }) : null;

  // ---- incidents ----
  const stored = await store.list('incidents', { where: [['date', 'in', [yesterday, date]]] });
  const all = [...(mode !== 'live' ? simIncidentDocs(net, date) : []), ...stored.filter((i) => Number.isInteger(i.edge) && i.edge >= 0 && i.edge < net.ne)];
  const activeInc = all.filter((i) => incidentActive(i, date, h, yesterday));
  const capMul = new Float32Array(net.ne).fill(1);
  for (const i of activeInc) capMul[i.edge] = Math.min(capMul[i.edge], clampCap(i.cap));

  // ---- works (illustrative seeds never apply) ----
  const works = (await store.list('works', { where: [['active', '==', true]] })).filter((w) => workActive(w, date, h));
  const workEdgeMap = new Map();
  for (const w of works) { const es = worksEdges(net, w); workEdgeMap.set(w.id, es); for (const e of es) capMul[e] = Math.min(capMul[e], clampCap(w.cap)); }

  // ---- calibration ----
  let boost = 1, calibration = null, stale = false;
  if (mode !== 'sim') {
    // A probe reading is "fresh" for as long as the cadence it is collected at allows: the paid connector's interval
    // (capped calls mean it runs less often than the tick) and the hourly night tick. Otherwise the feed would be
    // flagged stale between two perfectly healthy collections.
    const paid = (await store.list('connectors', { where: [['enabled', '==', true]] })).filter((c) => PAID.includes(c.type));
    const night = h >= 23 || h < 6, cadenceMin = Math.max(2 * Math.max(0, ...paid.map((c) => c.intervalMin ?? 0)), night ? settings.feed.idleTickMin + settings.feed.tickMin : 0);
    const staleMs = Math.max(settings.feed.staleAfterMin, cadenceMin) * 60000;
    const probes = (await store.list('probes', { where: [['enabled', '==', true]] }));
    const obs = await store.list('probe_obs', { where: [['at', '>=', now - staleMs]], orderBy: ['at', 'desc'], limit: 2000 });
    const latest = new Map(); for (const o of obs) if (o.at <= now + 60000 && !latest.has(o.probeId)) latest.set(o.probeId, o);
    const items = [];
    for (const p of probes) { const o = latest.get(p.id); if (o && o.minutes > 0) items.push({ from: p.fromNode, to: p.toNode, observedMin: o.minutes, freeMin: p.freeMin }); }
    if (items.length < MIN_FRESH_OBS) {
      stale = true;
      calibration = { skipped: true, reason: `only ${items.length} fresh probe observation(s); need ${MIN_FRESH_OBS}`, rmsePct: null, probes: items.length, at: now };
    } else {
      const c = calibrate(net, h, items, { capMul, lo: BOOST_MIN, hi: BOOST_MAX });
      boost = clamp(c.boost, BOOST_MIN, BOOST_MAX);
      calibration = { rmsePct: r1(c.rmsePct), probes: items.length, at: now };
    }
  }

  // ---- assignment + summary ----
  const res = assign(net, { t: h, capMul, boost, iters: 6 });
  const sum = summarize(net, res), enc = encodeState(res);
  const state = {
    t: now, hour: round2(h), date, mode, boost: Math.round(boost * 1000) / 1000, stale, updatedAt: now,
    net: { edges: net.ne, mapVersion: mapVersion(net) },
    city: { speed: r1(sum.speed), congPct: r1(sum.congPct) },
    stations: sum.per.map((p, i) => ({ i, speed: p.speed == null ? null : r1(p.speed), cong: r1(p.cong) })),
    vc: enc.vc, spd: enc.spd,
    incidents: activeInc.map((i) => ({ id: i.id, type: i.type, edge: i.edge, station: net.stn[i.edge], startHour: i.startHour, endHour: i.endHour, cap: i.cap, src: i.src })),
    works: works.map((w) => ({ id: w.id, name: w.name, road: w.road, stations: w.stations, cap: w.cap })),
    calibration,
  };

  // ---- actions ----
  const act = await deriveActions({ store, net, now, h, date, settings, res, activeInc, works, workEdgeMap, audit });

  const tickMs = Math.round(performance.now() - started);
  await store.set('state', 'current', state);
  await store.set('state', 'meta', { id: 'meta', tickMs, lastTickAt: now, idle, mode, activeIncidents: activeInc.length, activeWorks: works.length, calibrated: !!calibration && !calibration.skipped });
  const key = istMinuteKey(now);
  await store.set('state_hist', key, { id: key, t: now, mode, summary: { speed: state.city.speed, congPct: state.city.congPct, incidents: activeInc.length, works: works.length, boost: state.boost }, expireAt: now + 72 * 3600000 });
  return { ok: true, t: now, mode, idle, stale, boost: state.boost, tickMs, calibration, connectors: connectorRuns, ...act };
}

async function createIfAbsent(store, doc) {
  let created = false;
  await store.update('actions', doc.id, (cur) => { if (cur) return undefined; created = true; return doc; });
  return created;
}

export async function deriveActions({ store, net, now, h, date, settings, res, activeInc, works, workEdgeMap, audit }) {
  let created = 0, escalated = 0, verified = 0;
  const activeIds = new Set(activeInc.map((i) => i.id));
  // incident actions
  for (const i of activeInc) if (await createIfAbsent(store, buildIncidentAction(net, i, { now, hour: h, vc0: round2(res.vc[i.edge]) }))) created++;
  // congestion actions: worst edge per (road, station), vc >= 1.0
  const groups = new Map();
  for (let e = 0; e < net.ne; e++) {
    if (res.vc[e] < 1 || net.name[e] < 0 || net.cls[e] > 1) continue;
    const k = `${net.name[e]}|${net.stn[e]}`, g = groups.get(k);
    if (!g || res.vc[e] > res.vc[g]) groups.set(k, e);
  }
  const worst = [...groups.values()].sort((a, b) => res.vc[b] - res.vc[a] || a - b).slice(0, MAX_CONG_ACTIONS);
  if (worst.length) {
    const openCong = await store.list('actions', { where: [['date', '==', date]] });
    const taken = new Set(openCong.filter((a) => a.type === 'cong' && ['new', 'ack', 'prog', 'persist'].includes(a.state)).map((a) => `${roadName(net, a.edge)}|${a.station}`));
    for (const e of worst) {
      const road = roadName(net, e), station = stationName(net, e);
      if (taken.has(`${road}|${station}`)) continue;
      const incidentId = `cong-${date}-${e}`, vc = round2(res.vc[e]);
      const doc = {
        id: actionIdFor(incidentId), incidentId, type: 'cong', edge: e, station, region: stationRegion(net, station) ?? '',
        title: `Congestion on ${road}`, detail: `Modelled V/C ${vc.toFixed(2)}, speed about ${Math.round(res.spd[e])} km/h in ${station}. Modelled, not measured.`,
        pri: vc >= 1.3 ? 'hi' : 'md', state: 'new', raisedAt: now, raisedHour: round2(h), vc0: vc, escalated: false, date,
      };
      if (await createIfAbsent(store, doc)) created++;
    }
  }
  // work-start actions
  for (const w of works) {
    if (w.from !== date) continue;
    const station = w.stations?.[0]; if (!station) continue;
    const incidentId = `work-${w.id}-${date}`, edges = workEdgeMap.get(w.id) ?? [];
    const doc = {
      id: actionIdFor(incidentId), incidentId, type: 'work', edge: edges[0] ?? -1, station, region: stationRegion(net, station) ?? '',
      title: `${w.kind === 'roadwork' ? 'Road work' : w.kind} starts: ${w.name}`, detail: `${w.road} (${w.stations.join(', ')}), ${w.hours} hours, capacity held to ${Math.round(w.cap * 100)}% until ${w.to}.`,
      pri: w.cap <= 0.5 ? 'hi' : 'md', state: 'new', raisedAt: now, raisedHour: round2(h), escalated: false, date,
    };
    if (await createIfAbsent(store, doc)) created++;
  }
  // escalation
  const escMs = settings.workflow.escalateAfterMin * 60000;
  for (const a of await store.list('actions', { where: [['state', '==', 'new']] })) {
    if (a.escalated || now - a.raisedAt < escMs) continue;
    let did = false;
    await store.update('actions', a.id, (cur) => { if (!cur || cur.state !== 'new' || cur.escalated) return undefined; did = true; return { ...cur, escalated: true, escalatedAt: now, pri: 'hi' }; });
    if (did) { escalated++; await audit.write({ actor: 'system', kind: 'action_escalate', target: a.id, summary: `Escalated ${a.title} after ${settings.workflow.escalateAfterMin} min unacknowledged` }); }
  }
  // verification of done actions
  const verMs = settings.workflow.verifyAfterMin * 60000, workIds = new Set(works.map((w) => w.id));
  for (const a of await store.list('actions', { where: [['state', '==', 'done']] })) {
    if (a.verifiedAt || !a.doneAt || now - a.doneAt < verMs) continue;
    const vc1 = a.edge >= 0 && a.edge < net.ne ? round2(res.vc[a.edge]) : null;
    let persist;
    if (a.type === 'cong') persist = vc1 !== null && vc1 >= 0.9;
    else if (a.type === 'inc') persist = activeIds.has(a.incidentId);
    else persist = [...workIds].some((id) => a.incidentId.startsWith(`work-${id}-`));
    let did = false;
    await store.update('actions', a.id, (cur) => { if (!cur || cur.state !== 'done' || cur.verifiedAt) return undefined; did = true; return { ...cur, state: persist ? 'persist' : 'cleared', verifiedAt: now, vc0: cur.vc0 ?? null, vc1 }; });
    if (did) { verified++; await audit.write({ actor: 'system', kind: 'action_verify', target: a.id, summary: `Verified ${a.title}: ${persist ? 'persists' : 'cleared'} (vc ${vc1})`, meta: { vc0: a.vc0 ?? null, vc1 } }); }
  }
  return { created, escalated, verified };
}
