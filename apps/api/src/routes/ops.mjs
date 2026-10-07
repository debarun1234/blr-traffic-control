import { decodeState } from '@blr/model';
import { PERMISSIONS, REGIONS, hasPermission, canOnStation, canTransition, jurisdiction, lockedRegion, istParts } from '@blr/shared';
import { err, rid, validDate, validateWork, simIncidentDocs, buildIncidentAction, capForType, stationName, roadName, actionContext, briefContext, round2 } from '@blr/core';
import { bad, body, only, str, int, bool, limitParam } from '../http.mjs';

const OPEN = ['new', 'ack', 'prog', 'persist'];
const sortActions = (a, b) => (b.escalated === true) - (a.escalated === true) || b.raisedAt - a.raisedAt;
const need = (user, perm) => { if (!hasPermission(user, perm)) throw err('forbidden', `Requires ${perm}`); };
export const WORK_FIELDS = ['name', 'road', 'stations', 'station', 'from', 'to', 'hours', 'cap', 'kind', 'agency'];

export function registerOps(api, ctx) {
  const { store, net, clock, audit } = ctx, stations = net.map.st;
  const aud = (req, kind, target, summary, meta) => audit.write({ actor: req.user.email, role: req.user.role, kind, target, summary, ip: req.ip, meta });
  const overrides = () => store.list('stations');

  api.get('/me', async (req) => {
    const u = req.user, s = await ctx.settings();
    return { email: u.email, name: u.name ?? '', role: u.role, region: u.region ?? lockedRegion(u, stations), station: u.station ?? null, active: u.active !== false,
      permissions: [...(PERMISSIONS[u.role] ?? [])], lockedRegion: lockedRegion(u, stations), jurisdiction: [...jurisdiction(u, stations)], flags: { aiEnabled: !!s.ai.enabled, maintenance: !!s.maintenance } };
  });

  api.get('/state', async (req, reply) => {
    const st = await store.get('state', 'current');
    if (!st) throw err('unavailable', 'No state has been computed yet');
    const s = await ctx.settings();
    const stale = !!st.stale || clock.now() - st.updatedAt > s.feed.staleAfterMin * 60000;
    const doc = { ...st, stale }, tag = ctx.etag(doc);
    reply.header('etag', tag).header('cache-control', 'private, no-cache');
    if (req.headers['if-none-match'] === tag) return reply.status(304).send();
    return doc;
  });

  api.get('/crash', async () => {
    const rows = await store.list('crash_stats'), out = {}; let importedAt = 0;
    for (const r of rows) { out[r.station] = { y2025: r.y2025, hist: r.hist }; importedAt = Math.max(importedAt, r.importedAt ?? 0); }
    return { stations: out, importedAt: importedAt || null };
  });

  api.get('/actions', async (req) => {
    const q = req.query ?? {}, which = q.state ?? 'open';
    if (!['open', 'all'].includes(which)) bad('state must be open|all');
    const limit = limitParam(q.limit, 200, 500), region = lockedRegion(req.user, stations);
    const where = []; if (region) where.push(['region', '==', region]); if (which === 'open') where.push(['state', 'in', OPEN]);
    let rows = await store.list('actions', { where, ...(which === 'all' ? { orderBy: ['raisedAt', 'desc'], limit: 1000 } : {}) });
    rows.sort(sortActions);
    return { actions: rows.slice(0, limit) };
  });

  api.post('/actions/:id/transition', async (req) => {
    need(req.user, 'action.transition');
    const b = only(body(req), ['to', 'note']); const to = b.to; if (!['ack', 'prog', 'done'].includes(to)) bad('to must be ack|prog|done');
    const note = str(b.note, 'note', { optional: true, max: 300 }), now = clock.now();
    const a = await store.get('actions', req.params.id); if (!a) throw err('not_found', 'Action not found');
    if (!canOnStation(req.user, 'action.transition', a.station, stations)) throw err('forbidden', 'Action is outside your jurisdiction');
    let out;
    await store.update('actions', a.id, (cur) => {
      if (!cur || !canTransition(cur.state, to)) throw err('conflict', `Cannot move an action from ${cur?.state} to ${to}`);
      const n = { ...cur, state: to };
      if (to === 'ack') { n.ackAt = now; n.ackBy = req.user.email; }
      if (to === 'prog') { n.progAt = now; delete n.verifiedAt; delete n.vc1; }
      if (to === 'done') { n.doneAt = now; n.doneBy = req.user.email; }
      out = n; return n;
    });
    await aud(req, 'action_transition', a.id, `${a.state} -> ${to}: ${a.title}`, { from: a.state, to, note });
    return out;
  });

  api.get('/incidents', async (req) => {
    const date = req.query?.date ?? istParts(clock.now()).date; if (!validDate(date)) bad('date must be YYYY-MM-DD');
    const s = await ctx.settings();
    const stored = await store.list('incidents', { where: [['date', '==', date]] });
    const sim = s.feed.mode !== 'live' ? simIncidentDocs(net, date) : [];
    return { incidents: [...sim, ...stored].sort((x, y) => x.startHour - y.startHour) };
  });

  api.post('/incidents', async (req, reply) => {
    need(req.user, 'incident.report');
    const b = only(body(req), ['edge', 'type', 'durationMin', 'note']);
    const edge = int(b.edge, 'edge', 0, net.ne - 1), type = str(b.type, 'type', { max: 60 }), dur = int(b.durationMin, 'durationMin', 10, 240), note = str(b.note, 'note', { optional: true, max: 200 });
    const station = stationName(net, edge);
    if (!canOnStation(req.user, 'incident.report', station, stations)) throw err('forbidden', 'Edge is outside your jurisdiction');
    const now = clock.now(), { date, h } = istParts(now), id = `u-${now.toString(36)}-${rid(2)}`;
    const incident = { id, src: 'user', type, edge, station, date, startHour: round2(h), endHour: round2(h + dur / 60), cap: capForType(type), by: req.user.email, createdAt: now, ...(note ? { note } : {}) };
    let vc0; const st = await store.get('state', 'current');
    if (st?.vc) vc0 = round2(decodeState({ vc: st.vc, spd: st.spd, n: net.ne }).vc[edge]);
    const action = buildIncidentAction(net, incident, { now, hour: h, vc0, note });
    await store.batch([{ op: 'set', col: 'incidents', id, data: incident }, { op: 'set', col: 'actions', id: action.id, data: action }]);
    await aud(req, 'incident_report', id, `${type} on ${roadName(net, edge) ?? 'edge ' + edge} (${station})`, { edge, durationMin: dur });
    return reply.status(201).send({ incident, action });
  });

  // ---- works ----
  api.get('/works', async (req) => {
    const all = req.query?.includeInactive === '1';
    const rows = await store.list('works', all ? {} : { where: [['active', '==', true]] });
    return { works: rows.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)) };
  });
  api.post('/works', async (req, reply) => {
    need(req.user, 'works.write');
    const b = only(body(req), WORK_FIELDS), v = validateWork(b, net, { overrides: await overrides() });
    if (!v.ok) bad(v.reason);
    const now = clock.now(), w = { ...v.value, id: `w-${now.toString(36)}-${rid(2)}`, source: 'manual', active: true, by: req.user.email, createdAt: now };
    await store.set('works', w.id, w);
    await aud(req, 'works_create', w.id, `Created works "${w.name}" on ${w.road}`, { cap: w.cap, from: w.from, to: w.to });
    return reply.status(201).send(w);
  });
  api.patch('/works/:id', async (req) => {
    need(req.user, 'works.write');
    const b = only(body(req), [...WORK_FIELDS, 'active']), w = await store.get('works', req.params.id); if (!w) throw err('not_found', 'Works not found');
    const v = validateWork(b, net, { partial: true, overrides: await overrides() }); if (!v.ok) bad(v.reason);
    const patch = { ...v.value }; if ('active' in b) patch.active = bool(b.active, 'active');
    const next = { ...w, ...patch }; if (next.to < next.from) bad('to is before from');
    await store.set('works', w.id, next);
    await aud(req, 'works_update', w.id, `Updated works "${next.name}"`, { fields: Object.keys(patch) });
    return next;
  });
  api.delete('/works/:id', async (req) => {
    need(req.user, 'works.write');
    const w = await store.get('works', req.params.id); if (!w) throw err('not_found', 'Works not found');
    const next = { ...w, active: false }; await store.set('works', w.id, next);
    await aud(req, 'works_delete', w.id, `Deactivated works "${w.name}"`);
    return next;
  });

  // ---- AI ----
  const aiLimit = (req) => { const r = ctx.limiter.hit(`ai:${req.user.email}`, ctx.rl.aiPerMinute); if (!r.ok) throw err('rate_limited', 'Too many AI requests', { retryAfterSec: r.retryAfterSec }); };
  const needAi = () => { if (!ctx.ai) throw err('unavailable', 'AI is not configured'); return ctx.ai; };
  api.post('/ai/advise', async (req) => {
    const b = only(body(req), ['kind', 'context']), ai = needAi(); need(req.user, 'ai.advise'); aiLimit(req);
    const kind = b.kind, c = b.context ?? {}; if (typeof c !== 'object' || Array.isArray(c)) bad('context must be an object');
    let context = c;
    if (kind === 'action_advice' && c.actionId !== undefined) {
      const a = await store.get('actions', String(c.actionId)); if (!a) throw err('not_found', 'Action not found');
      const st = await store.get('state', 'current'), date = a.date;
      const inc = (await store.get('incidents', a.incidentId)) ?? simIncidentDocs(net, date).find((i) => i.id === a.incidentId);
      context = actionContext({ net, state: st, action: a, incident: inc, question: typeof c.question === 'string' ? c.question : undefined });
    } else if (kind === 'works_clash') {
      const st = await store.get('state', 'current'), ids = Array.isArray(c.workIds) ? c.workIds.map(String).slice(0, 15) : null;
      const works = (await store.list('works', { where: [['active', '==', true]] })).filter((w) => !ids || ids.includes(w.id));
      context = { works, simulated: st?.mode !== 'live', hour: st?.hour, incidents: (st?.incidents ?? []).map((i) => ({ type: i.type, road: roadName(net, i.edge), station: stations[i.station]?.n, endHour: i.endHour })) };
    }
    return ai.advise({ user: req.user, kind, context });
  });
  api.post('/ai/brief', async (req) => {
    const b = only(body(req), ['scope']), ai = needAi(); need(req.user, 'ai.brief'); aiLimit(req);
    const scope = b.scope ?? 'city'; if (scope !== 'city' && !REGIONS.includes(scope)) bad('scope must be city or a region');
    const st = await store.get('state', 'current'); if (!st) throw err('unavailable', 'No state has been computed yet');
    const actions = await store.list('actions', { where: [['state', 'in', OPEN]] });
    return ai.brief({ user: req.user, scope, context: briefContext({ net, state: st, actions, scope }) });
  });
  api.get('/ai/quota', async (req) => {
    if (!ctx.ai) return { used: 0, limit: 0, resetsAt: null, aiEnabled: false };
    return ctx.ai.quota(req.user);
  });
}
