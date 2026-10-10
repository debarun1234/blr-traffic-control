import { validateUser, normaliseEmail, hasPermission, canonStation } from '@blr/shared';
import { err, rid, validDate, importWorksCsv, importCrashCsv, applyWorks, applyCrash, putSettings, createApiKey, publicKey, KEY_SCOPES, validateConnector, CONNECTOR_TYPES, runChecks, toCsv, istDay, stationNames, xyToLatLon, callsToday, isObj, runTick } from '@blr/core';
import { bad, body, only, str, int, num, bool, limitParam, flag, msParam } from '../http.mjs';

const SLUG = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x';

export function registerAdmin(api, ctx) {
  const { store, net, clock, audit } = ctx, stations = net.map.st;
  const aud = (req, kind, target, summary, meta) => audit.write({ actor: req.user.email, role: req.user.role, kind, target, summary, ip: req.ip, meta });
  const A = '/admin';
  api.addHook('preHandler', async (req) => { if (req.url.startsWith('/api/admin') && !hasPermission(req.user, 'admin.access')) throw err('forbidden', 'Admin only'); });

  // ---------- users ----------
  const cleanUser = (b, base = {}) => {
    const u = { ...base, ...b };
    const out = { email: u.email, name: u.name ?? '', role: u.role, active: u.active !== false, ...(u.role === 'dcp' ? { region: u.region } : {}), ...(u.role === 'station' ? { station: u.station } : {}) };
    const p = validateUser(out, stations); if (p.length) bad(`invalid user: ${p.join(', ')}`);
    return out;
  };
  const activeAdmins = async () => (await store.list('users', { where: [['role', '==', 'admin'], ['active', '==', true]] }));
  async function guardAdminChange(req, target, next) {
    const losing = target.role === 'admin' && target.active !== false && (next.role !== 'admin' || next.active === false);
    if (!losing) return;
    if (target.email === req.user.email) throw err('conflict', 'You cannot demote or disable yourself');
    if ((await activeAdmins()).filter((u) => u.email !== target.email).length === 0) throw err('conflict', 'Cannot remove the last active admin');
  }
  api.get(`${A}/users`, async () => ({ users: (await store.list('users')).sort((a, b) => a.email.localeCompare(b.email)) }));
  api.post(`${A}/users`, async (req, reply) => {
    const b = only(body(req), ['email', 'name', 'role', 'region', 'station']), email = normaliseEmail(b.email);
    if (await store.get('users', email)) throw err('conflict', 'User already exists');
    const u = { ...cleanUser({ ...b, email, active: true }), createdBy: req.user.email, createdAt: clock.now() };
    if (u.name) u.name = str(u.name, 'name', { max: 100 });
    await store.set('users', email, u); ctx.auth.invalidate(email);
    await aud(req, 'user_create', email, `Added ${email} as ${u.role}`, { role: u.role, region: u.region, station: u.station });
    return reply.status(201).send(u);
  });
  api.patch(`${A}/users/:email`, async (req) => {
    const email = normaliseEmail(req.params.email), t = await store.get('users', email); if (!t) throw err('not_found', 'User not found');
    const b = only(body(req), ['role', 'region', 'station', 'active', 'name']);
    if (b.active !== undefined) bool(b.active, 'active');
    const next = cleanUser(b, t); await guardAdminChange(req, t, next);
    const doc = { ...t, ...next }; if (next.role !== 'dcp') delete doc.region; if (next.role !== 'station') delete doc.station;
    await store.set('users', email, doc); ctx.auth.invalidate(email);
    await aud(req, 'user_update', email, `Updated ${email}`, { changed: Object.keys(b) });
    return doc;
  });
  api.delete(`${A}/users/:email`, async (req) => {
    const email = normaliseEmail(req.params.email), t = await store.get('users', email); if (!t) throw err('not_found', 'User not found');
    await guardAdminChange(req, t, { ...t, active: false });
    const doc = { ...t, active: false }; await store.set('users', email, doc); ctx.auth.invalidate(email);
    await aud(req, 'user_disable', email, `Disabled ${email}`);
    return doc;
  });

  // ---------- stations & territories ----------
  api.get(`${A}/stations`, async () => {
    const ov = new Map((await store.list('stations')).map((s) => [canonStation(s.name), s])), crash = new Map((await store.list('crash_stats')).map((c) => [canonStation(c.station), c]));
    const rows = stations.map((s) => {
      const p = xyToLatLon(net.map, s.x, s.y), o = ov.get(s.n) ?? null, c = crash.get(s.n);
      return { name: s.n, region: s.r, zone: s.z, lat: o?.lat ?? +p.lat.toFixed(5), lon: o?.lon ?? +p.lon.toFixed(5), source: s.src, override: o, crash: { imported: !!c, importedAt: c?.importedAt ?? null, source: c?.source ?? null } };
    });
    return { stations: rows, crash: { stations: crash.size, of: stations.length, importedAt: Math.max(0, ...[...crash.values()].map((c) => c.importedAt ?? 0)) || null } };
  });
  api.patch(`${A}/stations/:name`, async (req) => {
    const name = canonStation(req.params.name); if (!stationNames(net).includes(name)) throw err('not_found', 'Unknown station');
    const b = only(body(req), ['lat', 'lon', 'aliases', 'notes', 'verified']), cur = (await store.get('stations', name)) ?? { name, verified: false };
    const next = { ...cur };
    if (b.lat !== undefined || b.lon !== undefined) { next.lat = num(b.lat, 'lat', 12.5, 13.5); next.lon = num(b.lon, 'lon', 77.2, 78.0); }
    if (b.aliases !== undefined) { if (!Array.isArray(b.aliases) || b.aliases.length > 10) bad('aliases must be an array of at most 10'); next.aliases = b.aliases.map((a) => str(a, 'alias', { max: 60 })); }
    if (b.notes !== undefined) next.notes = str(b.notes, 'notes', { min: 0, max: 500, optional: true }) ?? '';
    if (b.verified !== undefined) next.verified = bool(b.verified, 'verified');
    await store.set('stations', name, next);
    await aud(req, 'station_update', name, `Updated station ${name}`, { fields: Object.keys(b) });
    return next;
  });
  function validateGeo(g) {
    if (!isObj(g) || g.type !== 'FeatureCollection' || !Array.isArray(g.features)) bad('geojson must be a FeatureCollection');
    if (!g.features.length || g.features.length > 80) bad('1..80 features expected');
    const names = new Set(stationNames(net));
    for (const [i, f] of g.features.entries()) {
      const where = `features[${i}]`;
      if (!isObj(f) || f.type !== 'Feature' || f.geometry?.type !== 'Polygon') bad(`${where}: must be a Polygon Feature`);
      if (!names.has(f.properties?.station)) bad(`${where}: properties.station must be a known station`);
      const rings = f.geometry.coordinates; if (!Array.isArray(rings) || !rings.length) bad(`${where}: no rings`);
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.length > 5000) bad(`${where}: ring needs 4..5000 positions`);
        for (const p of ring) if (!Array.isArray(p) || p.length < 2 || !(p[0] >= 76.5 && p[0] <= 78.5 && p[1] >= 12.3 && p[1] <= 13.7)) bad(`${where}: position outside Bengaluru bounds`);
        const a = ring[0], z = ring.at(-1); if (a[0] !== z[0] || a[1] !== z[1]) bad(`${where}: ring is not closed`);
      }
    }
  }
  api.get(`${A}/territories`, async () => { const t = await store.get('territories', 'current'); return { territory: t, source: t ? 'custom' : 'built-in' }; });
  api.put(`${A}/territories`, { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const b = only(body(req), ['geojson']); validateGeo(b.geojson);
    if (JSON.stringify(b.geojson).length > 900000) bad('geojson too large for a single document (max ~900 KB)');
    const t = { id: 'current', geojson: b.geojson, uploadedBy: req.user.email, uploadedAt: clock.now(), source: 'admin-upload' };
    await store.set('territories', 'current', t);
    await aud(req, 'territories_put', 'territories/current', `Uploaded ${b.geojson.features.length} territory polygons`);
    return { territory: t, source: 'custom' };
  });
  api.delete(`${A}/territories`, async (req) => { await store.delete('territories', 'current'); await aud(req, 'territories_delete', 'territories/current', 'Reverted to built-in territories'); return { territory: null, source: 'built-in' }; });

  // ---------- connectors ----------
  const CONN_FIELDS = ['type', 'name', 'enabled', 'intervalMin', 'config', 'secretRef', 'dailyCap', 'mode'];
  const pubConn = (c) => c;
  const connFor = async (id) => { const c = await store.get('connectors', id); if (!c) throw err('not_found', 'Connector not found'); return c; };
  api.get(`${A}/connectors`, async () => ({ connectors: (await store.list('connectors')).sort((a, b) => a.name.localeCompare(b.name)).map(pubConn), types: CONNECTOR_TYPES }));
  api.post(`${A}/connectors`, async (req, reply) => {
    const b = only(body(req), CONN_FIELDS);
    const c = { id: `${SLUG(b.name ?? b.type)}-${rid(2)}`, type: b.type, name: b.name, enabled: b.enabled ?? false, intervalMin: b.intervalMin ?? 10, config: b.config ?? {}, mode: b.mode ?? 'live', createdBy: req.user.email, createdAt: clock.now(), failures: 0 };
    if (b.secretRef !== undefined) c.secretRef = b.secretRef; if (b.dailyCap !== undefined) c.dailyCap = b.dailyCap;
    const p = validateConnector(c); if (p.length) bad(p.join('; '));
    await store.set('connectors', c.id, c);
    await aud(req, 'connector_create', c.id, `Created connector ${c.name} (${c.type})`, { enabled: c.enabled, mode: c.mode });
    return reply.status(201).send(c);
  });
  api.patch(`${A}/connectors/:id`, async (req) => {
    const cur = await connFor(req.params.id), b = only(body(req), CONN_FIELDS.filter((k) => k !== 'type'));
    const c = { ...cur, ...b }; const p = validateConnector(c); if (p.length) bad(p.join('; '));
    if (b.enabled === true) { c.failures = 0; delete c.disabledReason; }
    await store.set('connectors', c.id, c);
    await aud(req, 'connector_update', c.id, `Updated connector ${c.name}`, { fields: Object.keys(b) });
    return c;
  });
  api.delete(`${A}/connectors/:id`, async (req) => { const c = await connFor(req.params.id); await store.delete('connectors', c.id); await aud(req, 'connector_delete', c.id, `Deleted connector ${c.name}`); return { ok: true }; });
  api.post(`${A}/connectors/:id/test`, async (req) => { const c = await connFor(req.params.id); const r = await ctx.connectors.test(c); await aud(req, 'connector_test', c.id, `Tested connector ${c.name}: ${r.ok ? 'ok' : 'failed'}`); return r; });
  api.post(`${A}/connectors/:id/run`, async (req) => { const c = await connFor(req.params.id); const r = await ctx.connectors.runNow(c.id); await aud(req, 'connector_run', c.id, `Ran connector ${c.name}: ${r.ok ? 'ok' : 'failed'}`);
    // New live data should show up now, not at the next scheduled tick: recompute the state once (no connectors, so no extra paid calls).
    let refreshed = false;
    if (r.ok && !r.shadow && r.count > 0) { try { await runTick({ store, net, now: clock.now(), settings: await ctx.settings(), idle: false }); refreshed = true; } catch { /* the scheduled tick will catch up */ } }
    return { ...r, refreshed }; });
  api.get(`${A}/connectors/:id/runs`, async (req) => {
    const c = await connFor(req.params.id);
    return { runs: await store.list('connector_runs', { where: [['connectorId', '==', c.id]], orderBy: ['at', 'desc'], limit: limitParam(req.query?.limit, 50, 200) }) };
  });

  // ---------- probes ----------
  const probeFields = (b, partial) => {
    const o = {}, req = (k) => !partial || b[k] !== undefined;
    if (req('name')) o.name = str(b.name, 'name', { max: 80 });
    if (req('fromNode')) o.fromNode = int(b.fromNode, 'fromNode', 0, net.nn - 1);
    if (req('toNode')) o.toNode = int(b.toNode, 'toNode', 0, net.nn - 1);
    if (req('fromLabel')) o.fromLabel = str(b.fromLabel ?? '', 'fromLabel', { min: 0, max: 80 });
    if (req('toLabel')) o.toLabel = str(b.toLabel ?? '', 'toLabel', { min: 0, max: 80 });
    if (req('freeMin')) o.freeMin = num(b.freeMin, 'freeMin', 0.5, 600);
    if (b.enabled !== undefined) o.enabled = bool(b.enabled, 'enabled'); else if (!partial) o.enabled = true;
    if (b.weight !== undefined) o.weight = num(b.weight, 'weight', 0, 10); else if (!partial) o.weight = 1;
    return o;
  };
  const PF = ['name', 'fromNode', 'toNode', 'fromLabel', 'toLabel', 'freeMin', 'enabled', 'weight'];
  api.get(`${A}/probes`, async () => ({ probes: (await store.list('probes')).sort((a, b) => a.name.localeCompare(b.name)) }));
  api.post(`${A}/probes`, async (req, reply) => {
    const p = { id: `p-${rid(3)}`, ...probeFields(only(body(req), PF), false) };
    if (p.fromNode === p.toNode) bad('fromNode and toNode must differ');
    await store.set('probes', p.id, p); await aud(req, 'probe_create', p.id, `Created probe ${p.name}`); return reply.status(201).send(p);
  });
  api.patch(`${A}/probes/:id`, async (req) => {
    const cur = await store.get('probes', req.params.id); if (!cur) throw err('not_found', 'Probe not found');
    const p = { ...cur, ...probeFields(only(body(req), PF), true) }; await store.set('probes', p.id, p); await aud(req, 'probe_update', p.id, `Updated probe ${p.name}`); return p;
  });
  api.delete(`${A}/probes/:id`, async (req) => { const cur = await store.get('probes', req.params.id); if (!cur) throw err('not_found', 'Probe not found'); await store.delete('probes', cur.id); await aud(req, 'probe_delete', cur.id, `Deleted probe ${cur.name}`); return { ok: true }; });
  api.get(`${A}/probes/observations`, async (req) => {
    const q = req.query ?? {}, where = q.probeId ? [['probeId', '==', String(q.probeId)]] : [];
    return { observations: await store.list('probe_obs', { where, orderBy: ['at', 'desc'], limit: limitParam(q.limit, 100, 500) }) };
  });

  // ---------- settings, checks, AI ----------
  api.get(`${A}/settings`, async () => ({ settings: await ctx.settings() }));
  const saveSettings = async (req, patch, kind, summary) => {
    const r = await putSettings(store, patch, ctx.env); if (r.errors.length) bad(r.errors.join('; '));
    await aud(req, kind, 'settings/app', summary, { sections: Object.keys(patch) }); return r.settings;
  };
  api.put(`${A}/settings`, async (req) => ({ settings: await saveSettings(req, body(req), 'settings_update', 'Updated application settings') }));
  api.get(`${A}/checks`, async () => (await store.get('checks', 'latest')) ?? { at: null, results: [] });
  api.post(`${A}/checks/run`, async (req) => { const r = await runChecks({ store, net, clock, env: ctx.env, timeSource: ctx.timeSource }); await aud(req, 'checks_run', 'checks/latest', 'Ran system checks'); return r; });
  api.get(`${A}/ai/usage`, async (req) => {
    const days = req.query?.days === undefined ? 14 : Number(req.query.days); if (!Number.isInteger(days) || days < 1 || days > 90) bad('days must be 1..90');
    const from = istDay(clock.now() - (days - 1) * 86400000), rows = await store.list('ai_usage', { where: [['date', '>=', from]], orderBy: 'date' });
    const t = rows.reduce((a, r) => ({ calls: a.calls + r.calls, tokensIn: a.tokensIn + r.tokensIn, tokensOut: a.tokensOut + r.tokensOut, cacheHits: a.cacheHits + r.cacheHits, estCostUsd: a.estCostUsd + r.estCostUsd }), { calls: 0, tokensIn: 0, tokensOut: 0, cacheHits: 0, estCostUsd: 0 });
    const s = await ctx.settings();
    return { days: rows, totals: { ...t, estCostUsd: Math.round(t.estCostUsd * 1e6) / 1e6 }, limits: { dailyCallCap: s.ai.dailyCallCap, briefPerDay: s.ai.briefPerDay, perUserDaily: s.ai.perUserDaily }, ai: { enabled: s.ai.enabled, killReason: s.ai.killReason }, paidCallsToday: { routes: await callsToday(store, 'routes', clock.now()), tomtom: await callsToday(store, 'tomtom', clock.now()) }, note: 'Cost figures are estimates from token counts and the price table in settings, not billing data.' };
  });
  api.put(`${A}/ai/limits`, async (req) => {
    const b = only(body(req), ['dailyCallCap', 'briefPerDay', 'perUserDaily', 'tiers', 'maxOutputTokens', 'timeoutMs', 'prices']);
    const s = await saveSettings(req, { ai: b }, 'ai_limits', 'Updated AI limits'); return { ai: s.ai };
  });
  api.post(`${A}/ai/kill`, async (req) => {
    const b = only(body(req), ['enabled', 'reason']), enabled = bool(b.enabled, 'enabled');
    const reason = str(b.reason, 'reason', { min: enabled ? 0 : 3, max: 300, optional: enabled }) ?? '';
    const s = await saveSettings(req, { ai: { enabled, killReason: enabled ? '' : reason } }, 'ai_kill', enabled ? 'Enabled AI' : `Disabled AI: ${reason}`);
    return { enabled: s.ai.enabled, killReason: s.ai.killReason };
  });

  // ---------- audit ----------
  async function auditRows(q) {
    const where = [], from = msParam(q.from, 'from'), to = msParam(q.to, 'to'), before = msParam(q.before, 'before');
    if (q.actor) where.push(['actor', '==', String(q.actor).toLowerCase()]); if (q.kind) where.push(['kind', '==', String(q.kind)]);
    if (from !== undefined) where.push(['at', '>=', from]); if (to !== undefined) where.push(['at', '<=', to]); if (before !== undefined) where.push(['at', '<', before]);
    return store.list('audit', { where, orderBy: ['at', 'desc'], limit: limitParam(q.limit, 100, 1000) });
  }
  api.get(`${A}/audit`, async (req) => { const rows = await auditRows(req.query ?? {}); return { audit: rows, next: rows.length ? rows.at(-1).at : null }; });
  api.get(`${A}/audit.csv`, async (req, reply) => {
    const rows = await auditRows({ limit: 1000, ...(req.query ?? {}) });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="audit.csv"').send(toCsv(['id', 'at', 'actor', 'role', 'kind', 'target', 'summary', 'ip', 'meta'], rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() }))));
  });

  // ---------- API keys ----------
  api.get(`${A}/apikeys`, async () => ({ apikeys: (await store.list('apikeys')).map(publicKey).sort((a, b) => b.createdAt - a.createdAt) }));
  api.post(`${A}/apikeys`, async (req, reply) => {
    const b = only(body(req), ['name', 'scopes', 'rateLimit']), name = str(b.name, 'name', { max: 80 });
    if (!Array.isArray(b.scopes) || !b.scopes.length || b.scopes.some((s) => !KEY_SCOPES.includes(s))) bad(`scopes must be a non-empty subset of ${KEY_SCOPES.join(', ')}`);
    const rateLimit = int(b.rateLimit ?? 60, 'rateLimit', 1, 6000);
    const { doc, key } = await createApiKey(store, { name, scopes: [...new Set(b.scopes)], rateLimit, createdBy: req.user.email, now: clock.now() });
    await aud(req, 'apikey_create', doc.id, `Created API key "${name}" (${doc.prefix}...)`, { scopes: doc.scopes });
    return reply.status(201).send({ key, apikey: publicKey(doc) });
  });
  api.delete(`${A}/apikeys/:id`, async (req) => {
    const k = await store.get('apikeys', req.params.id); if (!k) throw err('not_found', 'API key not found');
    await store.update('apikeys', k.id, { revoked: true }); await aud(req, 'apikey_revoke', k.id, `Revoked API key "${k.name}"`); return publicKey({ ...k, revoked: true });
  });

  // ---------- imports / exports ----------
  const csvBody = (req) => { if (typeof req.body !== 'string') bad('Send the CSV as text/csv'); return req.body; };
  api.post(`${A}/import/works`, { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const dry = flag(req.query?.dryRun), r = importWorksCsv(csvBody(req), net, { overrides: await store.list('stations') });
    if (r.error) bad(r.error);
    if (!dry && r.accepted.length) await applyWorks(store, r.accepted, { now: clock.now(), source: 'csv', by: req.user.email });
    await aud(req, dry ? 'import_works_dryrun' : 'import_works', 'works', `Works CSV: ${r.accepted.length} accepted, ${r.rejected.length} rejected${dry ? ' (dry run)' : ''}`);
    return { accepted: r.accepted.length, rejected: r.rejected, dryRun: dry };
  });
  api.post(`${A}/import/crash`, { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const dry = flag(req.query?.dryRun), r = importCrashCsv(csvBody(req), net, { now: clock.now(), overrides: await store.list('stations') });
    if (r.error) bad(r.error);
    if (!dry && r.accepted.length) await applyCrash(store, r.accepted, { now: clock.now(), source: `csv:${req.user.email}` });
    await aud(req, dry ? 'import_crash_dryrun' : 'import_crash', 'crash_stats', `Crash CSV: ${r.accepted.length} accepted, ${r.rejected.length} rejected${dry ? ' (dry run)' : ''}`);
    return { accepted: r.accepted.length, rejected: r.rejected, dryRun: dry };
  });
  api.get(`${A}/export/actions.csv`, async (req, reply) => {
    const q = req.query ?? {}, where = []; for (const [k, op] of [['from', '>='], ['to', '<=']]) if (q[k] !== undefined) { if (!validDate(q[k])) bad(`${k} must be YYYY-MM-DD`); where.push(['date', op, q[k]]); }
    const rows = (await store.list('actions', { where })).sort((a, b) => a.raisedAt - b.raisedAt).slice(0, 20000);
    const iso = (v) => (v ? new Date(v).toISOString() : '');
    const cols = ['id', 'date', 'type', 'station', 'region', 'title', 'pri', 'state', 'raisedAt', 'ackAt', 'ackBy', 'doneAt', 'doneBy', 'verifiedAt', 'escalated', 'vc0', 'vc1'];
    await aud(req, 'export_actions', 'actions', `Exported ${rows.length} actions`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="actions.csv"')
      .send(toCsv(cols, rows.map((r) => ({ ...r, raisedAt: iso(r.raisedAt), ackAt: iso(r.ackAt), doneAt: iso(r.doneAt), verifiedAt: iso(r.verifiedAt) }))));
  });
}

