import { decodeState } from '@blr/model';
import { PERMISSIONS, REGIONS, hasPermission, canOnStation, canTransition, jurisdiction, lockedRegion, istParts, actionIdFor, canonStation } from '@blr/shared';
import { createActivityTracker, runTick, err, rid, validDate, validateWork, simIncidentDocs, buildIncidentAction, capForType, stationName, roadName, actionContext, briefContext, round2 } from '@blr/core';
import { bad, body, only, str, int, bool, limitParam } from '../http.mjs';

const OPEN = ['new', 'ack', 'prog', 'persist'];
const sortActions = (a, b) => (b.escalated === true) - (a.escalated === true) || b.raisedAt - a.raisedAt;
const need = (user, perm) => { if (!hasPermission(user, perm)) throw err('forbidden', `Requires ${perm}`); };
export const WORK_FIELDS = ['name', 'road', 'stations', 'station', 'from', 'to', 'hours', 'cap', 'kind', 'agency'];

export function registerOps(api, ctx) {
  const { store, net, clock, audit } = ctx, stations = net.map.st;
  const aud = (req, kind, target, summary, meta) => audit.write({ actor: req.user.email, role: req.user.role, kind, target, summary, ip: req.ip, meta });
  const overrides = () => store.list('stations');
  const touch = createActivityTracker({ store, clock });

  // Waking from idle: while nobody was around, paid probe collection was paused, so readings are old. The first person back
  // triggers one normal tick in the background (connectors still obey their own interval and daily cap) instead of waiting
  // up to a tick for the stale banner to clear.
  async function wakeIfIdle() {
    if (refreshing) return;
    try {
      const meta = await store.get('state', 'meta'); if (!meta?.idle || refreshing) return;
      refreshing = true;
      try { await runTick({ store, net, now: clock.now(), connectors: ctx.connectors, settings: await ctx.settings(), idle: false }); } finally { refreshing = false; }
    } catch { /* the scheduled tick will catch up */ }
  }

  api.get('/me', async (req) => {
    void touch(); void wakeIfIdle();
    const u = req.user, s = await ctx.settings();
    return { email: u.email, name: u.name ?? '', role: u.role, region: u.region ?? lockedRegion(u, stations), station: u.station ? canonStation(u.station) : null, active: u.active !== false,
      permissions: [...(PERMISSIONS[u.role] ?? [])], lockedRegion: lockedRegion(u, stations), jurisdiction: [...jurisdiction(u, stations)], flags: { aiEnabled: !!s.ai.enabled, maintenance: !!s.maintenance }, map: s.map };
  });

  api.get('/state', async (req, reply) => {
    void touch(); void wakeIfIdle();
    const st = await store.get('state', 'current');
    if (!st) throw err('unavailable', 'No state has been computed yet');
    const s = await ctx.settings();
    const stale = !!st.stale || clock.now() - st.updatedAt > s.feed.staleAfterMin * 60000;
    const doc = { ...st, stale }, tag = ctx.etag(doc);
    reply.header('etag', tag).header('cache-control', 'private, no-cache');
    if (req.headers['if-none-match'] === tag) return reply.status(304).send();
    return doc;
  });

  // On-demand refresh: one tick now, for people with state.refresh. Connectors still obey their own intervals and daily caps
  // (runDue), so a refresh never makes an extra paid call. One refresh a minute for the whole city, and never two at once.
  let refreshing = false;
  api.post('/refresh', async (req) => {
    need(req.user, 'state.refresh');
    if (refreshing) throw err('conflict', 'A refresh is already running');
    const hit = ctx.limiter.hit('refresh:all', 1);
    if (!hit.ok) throw err('rate_limited', 'The feed was refreshed a moment ago. Try again shortly.', { retryAfterSec: hit.retryAfterSec });
    refreshing = true;
    try {
      void touch();
      const now = clock.now(), settings = await ctx.settings();
      const r = await runTick({ store, net, now, connectors: ctx.connectors, settings, idle: false });
      await aud(req, 'feed_refresh', 'state/current', 'Refreshed the feed on demand', { tickMs: r.tickMs });
      return { ok: true, updatedAt: now, tickMs: r.tickMs };
    } finally { refreshing = false; }
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
    return { actions: rows.slice(0, limit).map((a) => (a.station && canonStation(a.station) !== a.station ? { ...a, station: canonStation(a.station) } : a)) }; // stored records may carry a renamed station's old spelling
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

  // Incident lifecycle: extend, clear, confirm. Only stored incidents can change; simulated ones are model output.
  async function ownIncident(req, permission = 'incident.report') {
    need(req.user, permission);
    const inc = await store.get('incidents', req.params.id);
    if (!inc) { if (simIncidentDocs(net, istParts(clock.now()).date).some((i) => i.id === req.params.id)) throw err('conflict', 'Simulated incidents come from the model and cannot be changed'); throw err('not_found', 'Incident not found'); }
    if (!canOnStation(req.user, permission, inc.station, stations)) throw err('forbidden', 'Incident is outside your jurisdiction');
    if (inc.clearedAt) throw err('conflict', 'Incident is already cleared');
    return inc;
  }
  api.post('/incidents/:id/clear', async (req) => {
    const inc = await ownIncident(req), now = clock.now(), { date, h } = istParts(now);
    const end = round2(inc.date === date ? h : h + 24); // incidents started yesterday run on a 24+ hour clock
    const out = { ...inc, endHour: Math.min(inc.endHour, Math.max(inc.startHour, end)), clearedAt: now, clearedBy: req.user.email };
    const ops = [{ op: 'set', col: 'incidents', id: inc.id, data: out }];
    const act = await store.get('actions', actionIdFor(inc.id));
    if (act && act.state !== 'done') ops.push({ op: 'set', col: 'actions', id: act.id, data: { ...act, state: 'done', doneAt: now, doneBy: req.user.email, doneNote: 'Incident cleared' } });
    await store.batch(ops);
    await aud(req, 'incident_clear', inc.id, `${inc.type} cleared on ${roadName(net, inc.edge) ?? 'edge ' + inc.edge}`, { edge: inc.edge });
    return { incident: out };
  });
  api.post('/incidents/:id/extend', async (req) => {
    const inc = await ownIncident(req), b = only(body(req), ['minutes']), min = int(b.minutes, 'minutes', 10, 240), now = clock.now(), { h } = istParts(now);
    const nowHour = inc.date === istParts(now).date ? h : h + 24;
    if (inc.endHour < nowHour) throw err('conflict', 'Incident has already ended; report a new one');
    const out = { ...inc, endHour: round2(Math.min(inc.startHour + 12, inc.endHour + min / 60)), extendedAt: now, extendedBy: req.user.email };
    await store.set('incidents', inc.id, out);
    await aud(req, 'incident_extend', inc.id, `${inc.type} extended by ${min} min on ${roadName(net, inc.edge) ?? 'edge ' + inc.edge}`, { edge: inc.edge, minutes: min });
    return { incident: out };
  });
  api.post('/incidents/:id/confirm', async (req) => {
    const inc = await ownIncident(req), now = clock.now();
    if (inc.confirmedAt) return { incident: inc };
    const out = { ...inc, confirmedAt: now, confirmedBy: req.user.email };
    await store.set('incidents', inc.id, out);
    await aud(req, 'incident_confirm', inc.id, `${inc.type} confirmed on ${roadName(net, inc.edge) ?? 'edge ' + inc.edge}`, { edge: inc.edge });
    return { incident: out };
  });

  api.get('/incidents', async (req) => {
    const date = req.query?.date ?? istParts(clock.now()).date; if (!validDate(date)) bad('date must be YYYY-MM-DD');
    const s = await ctx.settings();
    const stored = await store.list('incidents', { where: [['date', '==', date]] });
    const sim = s.feed.mode !== 'live' ? simIncidentDocs(net, date) : [];
    return { incidents: [...sim, ...stored.map((i) => (i.station && canonStation(i.station) !== i.station ? { ...i, station: canonStation(i.station) } : i))].sort((x, y) => x.startHour - y.startHour) };
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
    const b = only(body(req), ['kind', 'context', 'lang']), ai = needAi(); const lang = b.lang === 'kn' ? 'kn' : 'en'; if (b.lang !== undefined && b.lang !== 'en' && b.lang !== 'kn') bad('lang must be en or kn'); need(req.user, 'ai.advise'); aiLimit(req);
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
    return ai.advise({ user: req.user, kind, context: { ...context, lang } });
  });
  api.post('/ai/brief', async (req) => {
    const b = only(body(req), ['scope', 'lang']), ai = needAi(); const lang = b.lang === 'kn' ? 'kn' : 'en'; if (b.lang !== undefined && b.lang !== 'en' && b.lang !== 'kn') bad('lang must be en or kn'); need(req.user, 'ai.brief'); aiLimit(req);
    const scope = b.scope ?? 'city'; if (scope !== 'city' && scope !== 'Urban' && !REGIONS.includes(scope)) bad('scope must be city, Urban or a region');
    const st = await store.get('state', 'current'); if (!st) throw err('unavailable', 'No state has been computed yet');
    const actions = await store.list('actions', { where: [['state', 'in', OPEN]] });
    return ai.brief({ user: req.user, scope, context: { ...briefContext({ net, state: st, actions, scope }), lang } });
  });
  api.get('/ai/quota', async (req) => {
    if (!ctx.ai) return { used: 0, limit: 0, resetsAt: null, aiEnabled: false };
    return ctx.ai.quota(req.user);
  });
}
