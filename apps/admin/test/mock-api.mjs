#!/usr/bin/env node
/** Mock of the admin API contract (docs/api-contract.md) with an in-memory store, serving apps/admin/dist.
 *  Implements the server safeguards the UI must surface: self-demote/disable, last admin, validation, CSV dry run.
 *  Run:  node apps/admin/test/mock-api.mjs [port]   (build first: node scripts/build-web.mjs)
 *  Dev sign-in: any seeded email, e.g. admin@blr.test (admin) or station.indira@blr.test (non-admin). */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { parseCsv, csvObjects, validateGeoJSON, validateSettings, validateAiLimits, validateSecretRef, toCsv, BBOX } from '../src/lib/logic.mjs';
import { validateConnectorForm, CONNECTOR_TYPES } from '../src/lib/connector-types.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const MAP = JSON.parse(readFileSync(join(root, 'packages/mapdata/map.json'), 'utf8'));
const NAMES = MAP.st.map((s) => s.n); const REGIONS = ['North', 'East', 'Central', 'West', 'South']; const ROLES = ['admin', 'commissioner', 'dcp', 'station', 'viewer'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const sha = (s) => createHash('sha256').update(s).digest('hex');
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (m) => new HttpError(400, 'invalid', m), conflict = (m) => new HttpError(409, 'conflict', m), nf = (m = 'Not found') => new HttpError(404, 'not_found', m);
const istDate = (ms = Date.now()) => new Date(ms + 19800000).toISOString().slice(0, 10);

export function createStore(now = Date.now()) {
  const s = { env: 'staging', seq: 100, now };
  const u = (email, role, o = {}) => [email, { email, name: o.name, role, region: o.region, station: o.station, active: o.active ?? true, createdBy: 'system', createdAt: now - 30 * DAY, lastLogin: o.lastLogin }];
  s.users = new Map([
    u('admin@blr.test', 'admin', { name: 'Asha Admin', lastLogin: now - 4 * MIN }), u('ops@blr.test', 'admin', { name: 'Ops Lead', lastLogin: now - 3 * HOUR }),
    u('commissioner@blr.test', 'commissioner', { name: 'City Commissioner', lastLogin: now - 20 * MIN }), u('dcp.east@blr.test', 'dcp', { name: 'DCP East', region: 'East', lastLogin: now - 10 * MIN }),
    u('station.indira@blr.test', 'station', { name: 'Indiranagar SHO', station: 'Indiranagar', lastLogin: now - 26 * HOUR }), u('viewer@blr.test', 'viewer', { name: 'Press Desk', lastLogin: now - 6 * DAY }),
    u('old.user@blr.test', 'viewer', { name: 'Former Officer', active: false, lastLogin: now - 90 * DAY })]);
  s.settings = { feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25 }, workflow: { escalateAfterMin: 15, verifyAfterMin: 30 },
    ai: { enabled: true, dailyCallCap: 800, perUserDaily: { admin: 100, commissioner: 60, dcp: 40, station: 25, viewer: 5 }, tiers: { t1: { enabled: true, model: 'gemini-2.5-flash-lite' }, t2: { enabled: true, model: 'gemini-2.5-flash' }, t3: { enabled: true, model: 'gemini-2.5-pro' } } },
    caps: { routesCallsPerDay: 1500, tomtomCallsPerDay: 2000 }, maintenance: false };
  const hubNode = (i) => MAP.hubs[i].node;
  s.probes = [
    { id: 'p1', name: 'Silk Board to Hebbal (ORR)', fromNode: hubNode(5), toNode: hubNode(3), fromLabel: MAP.hubs[5].n, toLabel: MAP.hubs[3].n, freeMin: 34, enabled: true, weight: 2 },
    { id: 'p2', name: 'CBD to Whitefield', fromNode: hubNode(0), toNode: hubNode(1), fromLabel: MAP.hubs[0].n, toLabel: MAP.hubs[1].n, freeMin: 52, enabled: true, weight: 1 },
    { id: 'p3', name: 'CBD to Airport', fromNode: hubNode(0), toNode: hubNode(6), fromLabel: MAP.hubs[0].n, toLabel: MAP.hubs[6].n, freeMin: 48, enabled: false, weight: 1 }];
  s.obs = []; for (const p of s.probes.slice(0, 2)) for (let i = 36; i >= 0; i--) s.obs.push({ probeId: p.id, at: now - i * 10 * MIN, minutes: +(p.freeMin * (1.2 + 0.7 * Math.sin(i / 5 + p.weight) ** 2)).toFixed(1), source: i % 3 ? 'google_routes' : 'ingest' });
  s.connectors = [
    { id: 'c1', type: 'sim', name: 'Built-in simulator', enabled: true, intervalMin: 10, config: {}, mode: 'live', createdBy: 'system', createdAt: now - 30 * DAY, lastRun: { at: now - 3 * MIN, ok: true, ms: 45, count: 10263 } },
    { id: 'c2', type: 'rest', name: 'ASTraM incidents', enabled: true, intervalMin: 5, mode: 'shadow', secretRef: 'astram-headers', config: { target: 'events', url: 'https://astram.example.gov.in/v1/incidents', method: 'GET', headerNames: ['Authorization'], itemsPath: 'data.items', mapping: { externalId: 'id', type: 'kind', lat: 'loc.lat', lon: 'loc.lon', durationMin: 'mins' } }, createdBy: 'admin@blr.test', createdAt: now - 5 * DAY, lastRun: { at: now - 4 * MIN, ok: true, ms: 412, count: 17 } },
    { id: 'c3', type: 'google_routes', name: 'Google Routes: key corridors', enabled: true, intervalMin: 10, mode: 'live', secretRef: 'routes-key', dailyCap: 400, config: { probeIds: ['p1', 'p2'], trafficModel: 'BEST_GUESS' }, createdBy: 'admin@blr.test', createdAt: now - 9 * DAY, lastRun: { at: now - 6 * MIN, ok: true, ms: 905, count: 2 } },
    { id: 'c4', type: 'gba_works', name: 'GBA works feed', enabled: true, intervalMin: 180, mode: 'live', config: { url: 'https://gba.example.gov.in/works/export.json', format: 'json', agency: 'GBA' }, createdBy: 'ops@blr.test', createdAt: now - 12 * DAY, lastRun: { at: now - 55 * MIN, ok: false, ms: 30012, count: 0, error: 'Timeout after 30 s reaching gba.example.gov.in' } }];
  s.runs = []; for (const c of s.connectors) for (let i = 0; i < 24; i++) { const at = now - (i * 25 + 3) * MIN; if (at < now - 14 * DAY) break; s.runs.push({ id: 'r' + s.runs.length, connectorId: c.id, at, ok: !(c.id === 'c4' && i < 2), ms: 300 + i * 13, count: c.id === 'c3' ? 2 : 10 + i, error: c.id === 'c4' && i < 2 ? 'Timeout after 30 s' : undefined, cost: c.id === 'c3' ? { calls: 2 } : undefined }); }
  s.apikeys = [{ id: 'k1', name: 'ANPR vendor, Silk Board', hash: sha('seed1'), prefix: 'blr_9f2a', scopes: ['events'], rateLimit: 120, createdBy: 'admin@blr.test', createdAt: now - 20 * DAY, lastUsed: now - 2 * MIN, revoked: false },
    { id: 'k2', name: 'BMRCL works export', hash: sha('seed2'), prefix: 'blr_71cc', scopes: ['works'], rateLimit: 30, createdBy: 'ops@blr.test', createdAt: now - 40 * DAY, lastUsed: now - 3 * DAY, revoked: false },
    { id: 'k3', name: 'Old pilot key', hash: sha('seed3'), prefix: 'blr_0b3d', scopes: ['events', 'speeds'], rateLimit: 60, createdBy: 'ops@blr.test', createdAt: now - 80 * DAY, revoked: true }];
  s.works = [
    { id: 'w1', name: 'Metro Phase 3 barricading', road: 'Outer Ring Road', stations: ['K R Puram'], from: istDate(now - 10 * DAY), to: istDate(now + 60 * DAY), hours: 'peak', cap: 0.7, kind: 'metro', agency: 'BMRCL', source: 'manual', active: true, by: 'commissioner@blr.test', createdAt: now - 10 * DAY },
    { id: 'w2', name: 'Storm-water drain', road: '80 Feet Road', stations: ['Indiranagar'], from: istDate(now - 2 * DAY), to: istDate(now + 20 * DAY), hours: 'all', cap: 0.6, kind: 'drain', agency: 'GBA', source: 'connector', active: true, by: 'c4', createdAt: now - 2 * DAY },
    { id: 'w3', name: 'Flyover resurfacing', road: 'Hosur Road', stations: ['Electronic City'], from: istDate(now + 5 * DAY), to: istDate(now + 15 * DAY), hours: 'night', cap: 0.5, kind: 'resurfacing', agency: 'GBA', source: 'csv', active: true, by: 'admin@blr.test', createdAt: now - DAY },
    { id: 'w4', name: 'Cable laying', road: 'Bellary Road', stations: ['Hebbal'], from: istDate(now - 30 * DAY), to: istDate(now - 3 * DAY), hours: 'all', cap: 0.8, kind: 'utility', agency: 'BESCOM', source: 'ingest', active: false, by: 'k2', createdAt: now - 30 * DAY }];
  s.incidents = [{ id: 'i1', src: 'sim', type: 'breakdown', edge: 4210, station: 'Halasooru', date: istDate(now), startHour: 8.5, endHour: 9.25, cap: 0.5 }, { id: 'i2', src: 'user', type: 'accident', edge: 912, station: 'Indiranagar', date: istDate(now), startHour: 9.1, endHour: 9.9, cap: 0.4, by: 'station.indira@blr.test' }, { id: 'i3', src: 'ingest', type: 'waterlogging', edge: 3377, station: 'Whitefield', date: istDate(now), startHour: 10, endHour: 11.5, cap: 0.3, connectorId: 'k1' }];
  s.actions = [{ id: 'A-i1', incidentId: 'i1', type: 'inc', station: 'Halasooru', region: 'East', title: 'Breakdown on ORR', pri: 'hi', state: 'new', raisedAt: now - 40 * MIN, escalated: true, date: istDate(now) }, { id: 'A-i2', incidentId: 'i2', type: 'inc', station: 'Indiranagar', region: 'East', title: 'Accident 100 Ft Road', pri: 'md', state: 'ack', raisedAt: now - 20 * MIN, escalated: false, date: istDate(now) }];
  s.crashImportedAt = null; s.stationOv = new Map(); s.territories = null;
  s.checks = { at: now - 9 * MIN, results: [
    { id: 'store', name: 'Database reachable', status: 'ok', detail: 'Round trip 14 ms', ms: 14 }, { id: 'feed', name: 'Feed freshness', status: 'ok', detail: 'Last tick 3 min ago', ms: 6 },
    { id: 'connectors', name: 'Connector health', status: 'fail', detail: '1 of 4 failing: GBA works feed', ms: 22 }, { id: 'budget', name: 'AI and paid API budget', status: 'warn', detail: 'Google Routes at 83% of daily cap', ms: 9 }, { id: 'secrets', name: 'Secrets resolve', status: 'ok', detail: '2 secretRefs found', ms: 188 }] };
  s.usage = []; for (let i = 13; i >= 0; i--) { const d = istDate(now - i * DAY); const k = Math.sin(i * 1.7) * 0.5 + 0.5; const t0 = Math.round(120 + 60 * k), t1 = Math.round(60 + 40 * k), t2 = Math.round(90 + 70 * k), t3 = i % 2 ? 0 : 3; const part = i === 0 ? 0.55 : 1; const calls = Math.round((t1 + t2 + t3) * part), hits = Math.round((30 + 50 * k) * part);
    s.usage.push({ date: d, calls, tokensIn: calls * 900, tokensOut: calls * 260, byTier: { t0: Math.round(t0 * part), t1: Math.round(t1 * part), t2: Math.round(t2 * part), t3 }, cacheHits: hits, estCostUsd: +(calls * 0.0042).toFixed(2), byUser: i === 0 ? { 'commissioner@blr.test': 14, 'dcp.east@blr.test': 22, 'station.indira@blr.test': 9, 'admin@blr.test': 3 } : {} }); }
  s.audit = []; const kinds = [['user.create', 'Added user'], ['connector.run', 'Ran connector'], ['settings.update', 'Updated settings'], ['apikey.create', 'Created API key'], ['probe.create', 'Created probe'], ['action.transition', 'Action acknowledged']];
  for (let i = 0; i < 130; i++) { const [k, t] = kinds[i % kinds.length]; s.audit.push({ id: 'a' + (1000 - i), at: now - i * 17 * MIN, actor: i % 4 ? 'admin@blr.test' : 'ops@blr.test', role: 'admin', kind: k, target: k.split('.')[0] + '/' + (i + 1), summary: `${t} #${i + 1}`, ip: '10.0.0.' + (i % 20), meta: i % 3 ? { before: { n: i }, after: { n: i + 1 } } : undefined }); }
  s.audit.splice(5, 0, { id: 'a-bk', at: now - 3 * DAY, actor: 'system', role: 'admin', kind: 'budget_kill', target: 'settings/app', summary: 'Budget reached 100%: AI disabled, paid connectors disabled', meta: { costAmount: 100, budgetAmount: 100 } });
  s.audit.sort((a, b) => b.at - a.at);
  return s;
}

export function startMock({ port = 0, dist = join(here, '..', 'dist'), env = 'staging', controlUrl = 'https://control.example.test/' } = {}) {
  let S = createStore(); S.env = env;
  const audit = (user, kind, target, summary, meta) => S.audit.unshift({ id: 'a' + ++S.seq, at: Date.now(), actor: user.email, role: user.role, kind, target, summary, ip: '127.0.0.1', meta });
  const publicKey = (k) => { const { hash, ...r } = k; return r; };
  const activeAdmins = () => [...S.users.values()].filter((u) => u.role === 'admin' && u.active);
  const need = (cond, msg) => { if (!cond) throw bad(msg); };

  async function body(req, raw) { const chunks = []; for await (const c of req) chunks.push(c); const t = Buffer.concat(chunks).toString('utf8'); if (raw) return t; if (!t) return {}; try { return JSON.parse(t); } catch { throw bad('Body is not valid JSON'); } }
  const send = (res, status, data, type = 'application/json') => { const b = typeof data === 'string' ? data : JSON.stringify(data); res.writeHead(status, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' }); res.end(b); };
  const settingsOut = () => structuredClone(S.settings);

  async function api(req, res, url, path) {
    const email = String(req.headers['x-dev-user'] ?? '').toLowerCase(); if (!email) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const user = S.users.get(email); if (!user || !user.active) throw new HttpError(403, 'forbidden', 'This account is not on the allowlist');
    const m = req.method, q = url.searchParams, seg = path.split('/').filter(Boolean).slice(1); // after 'api'
    if (seg[0] === 'me' && m === 'GET') { user.lastLogin = Date.now(); return { email, name: user.name, role: user.role, region: user.region, station: user.station, active: true, permissions: [], lockedRegion: null, jurisdiction: [], flags: { aiEnabled: S.settings.ai.enabled, maintenance: S.settings.maintenance } }; }
    if (seg[0] === 'state') return { t: Date.now(), hour: 12, date: istDate(), mode: S.settings.feed.mode, boost: 1.12, stale: false, updatedAt: S.stateAt ?? Date.now() - 3 * MIN, net: { edges: 10263, mapVersion: 'test' }, city: { speed: 31, congPct: 12 }, stations: [], incidents: [], works: [], calibration: { rmsePct: 9.1, probes: S.probes.filter((p) => p.enabled).length, at: Date.now() - 8 * MIN } };
    if (seg[0] === 'preflight' && m === 'POST') {
      const base = { at: Date.now(), day: istDate(), api: { ok: true, ms: 9 }, data: { ok: true, mode: 'sim', ageMin: 3, stale: false, limitMin: 25 }, ai: { status: 'ok', model: 'gemini-test', cached: false }, glance: { incidents: 1, actions: 2, works: 3, stations: 53 } };
      return user.role === 'admin' ? { ...base, platform: { system: { at: Date.now(), cached: true, ok: 7, warn: 1, fail: 0, worst: [] }, users: { active: [...S.users.values()].filter((x) => x.active).length, total: S.users.size }, connectors: { enabled: 0, failing: 0, total: 0 }, ai: { calls: 4, cap: 400 } } } : base;
    }
    if (seg[0] === 'actions') return { actions: S.actions };
    if (seg[0] === 'incidents') return { incidents: S.incidents.filter((i) => i.date === (q.get('date') || istDate())) };
    if (seg[0] === 'crash') return { stations: Object.fromEntries(NAMES.slice(0, 12).map((n, i) => [n, { y2025: { fatal: 3 + (i % 7), nonfatal: 10 + i }, hist: { 2023: [4 + i % 5, 12], 2024: [5, 14 + i] } }])), importedAt: S.crashImportedAt };
    if (seg[0] === 'works') { if (m === 'GET') return { works: S.works }; if (m === 'DELETE') { const w = S.works.find((x) => x.id === seg[1]); if (!w) throw nf(); w.active = false; audit(user, 'works.write', 'works/' + w.id, `Deactivated work ${w.name}`); return w; } }
    if (seg[0] !== 'admin') throw nf();
    if (user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin role required');
    const [, a, b, c] = seg; const id = b && decodeURIComponent(b);
    switch (a) {
      case 'users': {
        if (m === 'GET') return { users: [...S.users.values()] };
        if (m === 'POST') { const d = await body(req); const e = String(d.email ?? '').trim().toLowerCase(); need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), 'email is not valid'); need(ROLES.includes(d.role), 'role is not valid'); if (d.role === 'dcp') need(REGIONS.includes(d.region), 'region is required for a DCP'); if (d.role === 'station') need(NAMES.includes(d.station), 'a known station is required for a station user'); if (S.users.has(e)) throw conflict(`${e} already exists`);
          const nu = { email: e, name: d.name, role: d.role, region: d.region, station: d.station, active: true, createdBy: email, createdAt: Date.now() }; S.users.set(e, nu); audit(user, 'user.create', 'users/' + e, `Added ${e} as ${d.role}`); return nu; }
        const t = S.users.get(id); if (!t) throw nf('No such user');
        if (m === 'PATCH') { const d = await body(req); const selfEdit = id === email; if (selfEdit && d.role && d.role !== 'admin') throw conflict('You cannot demote yourself. Ask another admin.'); if (selfEdit && d.active === false) throw conflict('You cannot deactivate yourself. Ask another admin.');
          if (d.role) need(ROLES.includes(d.role), 'role is not valid'); const role = d.role ?? t.role; if (role === 'dcp') need(REGIONS.includes(d.region ?? t.region), 'region is required for a DCP'); if (role === 'station') need(NAMES.includes(d.station ?? t.station), 'a known station is required for a station user');
          if (t.role === 'admin' && t.active && (role !== 'admin' || d.active === false) && activeAdmins().length <= 1) throw conflict('The last active admin cannot be removed.');
          for (const k of ['name', 'role', 'region', 'station', 'active']) if (k in d) t[k] = d[k] ?? undefined; audit(user, 'user.update', 'users/' + id, `Updated ${id}`, d); return t; }
        if (m === 'DELETE') { if (id === email) throw conflict('You cannot deactivate yourself. Ask another admin.'); if (t.role === 'admin' && activeAdmins().length <= 1) throw conflict('The last active admin cannot be removed.'); t.active = false; audit(user, 'user.deactivate', 'users/' + id, `Deactivated ${id}`); return t; }
        break; }
      case 'stations': {
        if (m === 'GET') return { stations: [...S.stationOv.values()], crash: { importedAt: S.crashImportedAt, source: S.crashImportedAt ? 'csv import' : 'seed', stations: 53 } };
        if (m === 'PATCH') { need(NAMES.includes(id), 'Unknown station'); const d = await body(req); need(Number.isFinite(d.lat) && d.lat >= BBOX.lat[0] && d.lat <= BBOX.lat[1], 'lat outside Bengaluru'); need(Number.isFinite(d.lon) && d.lon >= BBOX.lon[0] && d.lon <= BBOX.lon[1], 'lon outside Bengaluru'); need(!d.aliases || Array.isArray(d.aliases), 'aliases must be a list');
          const o = { name: id, lat: d.lat, lon: d.lon, aliases: d.aliases ?? [], notes: d.notes ?? '', verified: !!d.verified }; S.stationOv.set(id, o); audit(user, 'station.update', 'stations/' + id, `Updated station ${id}`, d); return o; } break; }
      case 'territories': {
        if (m === 'GET') return { territories: S.territories };
        if (m === 'PUT') { const d = await body(req); const r = validateGeoJSON(d.geojson, NAMES); if (r.errors.length) throw bad(r.errors[0]); S.territories = { geojson: d.geojson, uploadedBy: email, uploadedAt: Date.now(), source: 'upload' }; audit(user, 'territories.put', 'territories/current', `Uploaded ${d.geojson.features.length} boundaries`); return S.territories; }
        if (m === 'DELETE') { S.territories = null; audit(user, 'territories.delete', 'territories/current', 'Reverted to built-in boundaries'); return { ok: true }; } break; }
      case 'connectors': {
        if (m === 'GET' && !id) return { connectors: S.connectors };
        const validate = (d, type, full) => { const T = CONNECTOR_TYPES[type]; need(!!T, 'Unknown connector type'); if (full || 'name' in d) need(String(d.name ?? '').trim().length >= 3, 'name is required (3+ characters)'); const e = validateConnectorForm(type, { name: d.name ?? 'xxx', intervalMin: d.intervalMin ?? 10, dailyCap: d.dailyCap ?? undefined, config: d.config ?? {} }, S.probes.map((p) => p.id)); if (full) { const k = Object.entries(e)[0]; if (k) throw bad(`${k[0]}: ${k[1]}`); } const sr = validateSecretRef(d.secretRef, full && T.secret === 'required'); if (sr) throw bad('secretRef: ' + sr); if (d.mode) need(['live', 'shadow'].includes(d.mode), 'mode must be live or shadow'); };
        if (m === 'POST' && !id) { const d = await body(req); validate(d, d.type, true); const cn = { id: 'c' + ++S.seq, type: d.type, name: d.name.trim(), enabled: d.enabled ?? true, intervalMin: d.intervalMin, config: d.config ?? {}, secretRef: d.secretRef || undefined, dailyCap: d.dailyCap || undefined, mode: d.mode ?? 'shadow', createdBy: email, createdAt: Date.now() }; S.connectors.push(cn); audit(user, 'connector.create', 'connectors/' + cn.id, `Created connector ${cn.name}`); return cn; }
        const cn = S.connectors.find((x) => x.id === id); if (!cn) throw nf('No such connector');
        if (c === 'test' && m === 'POST') { const url = cn.config?.url ?? ''; const ms = 80 + (cn.name.length * 7) % 200; audit(user, 'connector.test', 'connectors/' + id, `Dry run of ${cn.name}`); if (/fail/.test(url) || /fail/i.test(cn.name)) return { ok: false, ms: 30000, error: 'HTTP 502 from upstream', sample: null }; return { ok: true, ms, sample: [{ externalId: 'A-9912', type: 'breakdown', lat: 12.9352, lon: 77.6245, durationMin: 45 }, { externalId: 'A-9913', type: 'accident', lat: 12.9716, lon: 77.5946, durationMin: 30 }] }; }
        if (c === 'run' && m === 'POST') { const ok = !/fail/.test(cn.config?.url ?? '') && !/fail/i.test(cn.name); const run = { id: 'r' + ++S.seq, connectorId: id, at: Date.now(), ok, ms: ok ? 240 : 30000, count: ok ? 5 : 0, error: ok ? undefined : 'HTTP 502 from upstream', cost: CONNECTOR_TYPES[cn.type].paid ? { calls: cn.config?.probeIds?.length ?? 1 } : undefined }; S.runs.unshift(run); cn.lastRun = { at: run.at, ok, ms: run.ms, count: run.count, error: run.error }; audit(user, 'connector.run', 'connectors/' + id, `Ran ${cn.name}: ${ok ? run.count + ' records' : run.error}`); return run; }
        if (c === 'runs' && m === 'GET') return { runs: S.runs.filter((r) => r.connectorId === id).slice(0, +(q.get('limit') ?? 50)) };
        if (m === 'PATCH') { const d = await body(req); validate(d, cn.type, false); for (const k of ['name', 'enabled', 'intervalMin', 'config', 'secretRef', 'dailyCap', 'mode']) if (k in d) cn[k] = d[k] ?? undefined; audit(user, 'connector.update', 'connectors/' + id, `Updated ${cn.name}`, Object.keys(d)); return cn; }
        if (m === 'DELETE') { S.connectors = S.connectors.filter((x) => x.id !== id); audit(user, 'connector.delete', 'connectors/' + id, `Deleted ${cn.name}`); return { ok: true }; } break; }
      case 'probes': {
        if (b === 'observations') { const n = +(q.get('limit') ?? 100); return { observations: S.obs.filter((o) => !q.get('probeId') || o.probeId === q.get('probeId')).sort((x, y) => y.at - x.at).slice(0, n) }; }
        if (m === 'GET') return { probes: S.probes };
        const chk = (d, full) => { if (full || 'name' in d) need(String(d.name ?? '').trim().length >= 3, 'name is required'); if (full || 'fromNode' in d) { need(Number.isInteger(d.fromNode) && Number.isInteger(d.toNode) && d.fromNode >= 0 && d.toNode >= 0 && d.fromNode < MAP.nn && d.toNode < MAP.nn, 'fromNode and toNode must be route node ids'); need(d.fromNode !== d.toNode, 'fromNode and toNode must differ'); } if (full || 'freeMin' in d) need(d.freeMin >= 1 && d.freeMin <= 240, 'freeMin must be 1 to 240'); };
        if (m === 'POST') { const d = await body(req); chk(d, true); const p = { id: 'p' + ++S.seq, name: d.name.trim(), fromNode: d.fromNode, toNode: d.toNode, fromLabel: d.fromLabel ?? '', toLabel: d.toLabel ?? '', freeMin: d.freeMin, enabled: d.enabled ?? true, weight: d.weight ?? 1 }; S.probes.push(p); audit(user, 'probe.create', 'probes/' + p.id, `Created probe ${p.name}`); return p; }
        const p = S.probes.find((x) => x.id === id); if (!p) throw nf('No such probe');
        if (m === 'PATCH') { const d = await body(req); chk(d, false); Object.assign(p, Object.fromEntries(Object.entries(d).filter(([k]) => ['name', 'fromNode', 'toNode', 'fromLabel', 'toLabel', 'freeMin', 'enabled', 'weight'].includes(k)))); audit(user, 'probe.update', 'probes/' + id, `Updated probe ${p.name}`); return p; }
        if (m === 'DELETE') { S.probes = S.probes.filter((x) => x.id !== id); audit(user, 'probe.delete', 'probes/' + id, `Deleted probe ${p.name}`); return { ok: true }; } break; }
      case 'settings': {
        if (m === 'GET') return { settings: settingsOut() };
        if (m === 'PUT') { const d = await body(req); const unknown = Object.keys(d).filter((k) => !['feed', 'workflow', 'ai', 'caps', 'maintenance'].includes(k)); need(!unknown.length, 'Unknown keys: ' + unknown.join(', ')); const e = validateSettings(d); const k = Object.entries(e)[0]; if (k) throw bad(`${k[0]}: ${k[1]}`); const before = settingsOut(); S.settings = { ...S.settings, ...d, ai: S.settings.ai }; audit(user, 'settings.update', 'settings/app', 'Updated settings', { before: { feed: before.feed, workflow: before.workflow, caps: before.caps, maintenance: before.maintenance }, after: { feed: d.feed, workflow: d.workflow, caps: d.caps, maintenance: d.maintenance } }); return { settings: settingsOut() }; } break; }
      case 'checks': {
        if (m === 'GET') return S.checks;
        if (b === 'run' && m === 'POST') { const failing = S.connectors.filter((x) => x.enabled && x.lastRun && !x.lastRun.ok); S.checks = { at: Date.now(), results: [{ id: 'store', name: 'Database reachable', status: 'ok', detail: 'Round trip 12 ms', ms: 12 }, { id: 'feed', name: 'Feed freshness', status: S.settings.maintenance ? 'warn' : 'ok', detail: S.settings.maintenance ? 'Maintenance mode: feed paused' : 'Last tick 3 min ago', ms: 5 }, { id: 'connectors', name: 'Connector health', status: failing.length ? 'fail' : 'ok', detail: failing.length ? `${failing.length} failing: ${failing.map((x) => x.name).join(', ')}` : 'All enabled connectors healthy', ms: 19 }, { id: 'budget', name: 'AI and paid API budget', status: 'ok', detail: 'Under all daily caps', ms: 8 }, { id: 'secrets', name: 'Secrets resolve', status: 'ok', detail: 'All secretRefs resolve', ms: 171 }] }; audit(user, 'checks.run', 'checks/latest', 'Ran system checks'); return S.checks; } break; }
      case 'ai': {
        if (b === 'usage') return { usage: S.usage.slice(-Math.min(+(q.get('days') ?? 14), 14)) };
        if (b === 'limits' && m === 'PUT') { const d = await body(req); const e = validateAiLimits(d); const k = Object.entries(e)[0]; if (k) throw bad(`${k[0]}: ${k[1]}`); Object.assign(S.settings.ai, { dailyCallCap: d.dailyCallCap, perUserDaily: d.perUserDaily, tiers: d.tiers }); audit(user, 'ai.limits', 'settings/app', 'Updated AI limits', d); return { ai: S.settings.ai }; }
        if (b === 'kill' && m === 'POST') { const d = await body(req); need(typeof d.enabled === 'boolean', 'enabled must be true or false'); need(String(d.reason ?? '').trim().length >= 5, 'A reason of at least 5 characters is required'); S.settings.ai.enabled = d.enabled; S.settings.ai.killReason = d.enabled ? undefined : d.reason.trim(); audit(user, 'ai.kill', 'settings/app', `AI ${d.enabled ? 'enabled' : 'disabled'}: ${d.reason.trim()}`); return { ai: S.settings.ai }; } break; }
      case 'audit.csv': case 'audit': {
        const actor = (q.get('actor') ?? '').toLowerCase(), kind = q.get('kind') ?? '', from = +q.get('from') || 0, to = +q.get('to') || Infinity, lim = Math.min(+(q.get('limit') ?? 50), 500);
        let rows = S.audit.filter((r) => (!actor || r.actor.toLowerCase().includes(actor)) && (!kind || r.kind === kind) && r.at >= from && r.at <= to);
        if (a === 'audit.csv') return { __csv: toCsv(rows.map((r) => ({ ...r, meta: r.meta ? JSON.stringify(r.meta) : '' })), ['id', 'at', 'actor', 'role', 'kind', 'target', 'summary', 'ip', 'meta']), name: 'audit.csv' };
        const before = q.get('before'); if (before) { const i = rows.findIndex((r) => r.id === before); rows = i >= 0 ? rows.slice(i + 1) : []; }
        const page = rows.slice(0, lim); return { audit: page, next: rows.length > lim ? page.at(-1).id : null }; }
      case 'apikeys': {
        if (m === 'GET') return { keys: S.apikeys.map(publicKey) };
        if (m === 'POST') { const d = await body(req); need(String(d.name ?? '').trim().length >= 3, 'name is required'); need(Array.isArray(d.scopes) && d.scopes.length && d.scopes.every((x) => ['events', 'speeds', 'works'].includes(x)), 'scopes must be a non-empty list of events, speeds, works'); need(d.rateLimit == null || (d.rateLimit >= 1 && d.rateLimit <= 6000), 'rateLimit must be 1 to 6000');
          const plain = 'blr_' + randomBytes(24).toString('hex'); const k = { id: 'k' + ++S.seq, name: d.name.trim(), hash: sha(plain), prefix: plain.slice(0, 8), scopes: d.scopes, rateLimit: d.rateLimit ?? 60, createdBy: email, createdAt: Date.now(), revoked: false }; S.apikeys.push(k); audit(user, 'apikey.create', 'apikeys/' + k.id, `Created key ${k.name} (${k.prefix})`, { scopes: k.scopes }); return { ...publicKey(k), key: plain }; }
        if (m === 'DELETE') { const k = S.apikeys.find((x) => x.id === id); if (!k) throw nf(); k.revoked = true; audit(user, 'apikey.revoke', 'apikeys/' + id, `Revoked key ${k.name}`); return publicKey(k); } break; }
      case 'import': {
        const kind = b; need(['works', 'crash'].includes(kind), 'Unknown import kind'); const text = await body(req, true); const { header, rows } = csvObjects(text); const dry = q.get('dryRun') === '1';
        const need_ = kind === 'works' ? ['name', 'road', 'station', 'from', 'to'] : ['station', 'year', 'fatal', 'nonfatal']; const miss = need_.filter((c) => !header.includes(c)); if (miss.length) throw bad('Missing columns: ' + miss.join(', '));
        const accepted = [], rejected = [];
        rows.forEach((r, i) => { const row = i + 2; const fail = (reason) => rejected.push({ row, reason });
          if (kind === 'works') { if (!r.name || !r.road) return fail('name and road are required'); if (!NAMES.includes(r.station)) return fail(`unknown station "${r.station}"`); if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) return fail('from and to must be YYYY-MM-DD'); if (r.to < r.from) return fail('to is before from'); const hours = r.hours || 'all'; if (!['all', 'peak', 'night'].includes(hours)) return fail(`hours must be all, peak or night (got "${r.hours}")`); const cap = r.cap === '' || r.cap == null ? 0.7 : Number(r.cap); if (!(cap >= 0 && cap <= 1)) return fail('cap must be between 0 and 1'); accepted.push({ name: r.name, road: r.road, station: r.station, from: r.from, to: r.to, hours, cap, kind: r.kind || 'other', agency: r.agency || '' }); }
          else { if (!NAMES.includes(r.station)) return fail(`unknown station "${r.station}"`); const y = +r.year, f = +r.fatal, nfa = +r.nonfatal; if (!(y >= 2010 && y <= 2030)) return fail('year must be 2010 to 2030'); if (![f, nfa].every((v) => Number.isInteger(v) && v >= 0)) return fail('fatal and nonfatal must be whole numbers 0 or more'); accepted.push({ station: r.station, year: y, fatal: f, nonfatal: nfa }); } });
        if (!dry) { if (kind === 'works') for (const w of accepted) S.works.push({ id: 'w' + ++S.seq, name: w.name, road: w.road, stations: [w.station], from: w.from, to: w.to, hours: w.hours, cap: w.cap, kind: w.kind, agency: w.agency, source: 'csv', active: true, by: email, createdAt: Date.now() }); else S.crashImportedAt = Date.now(); audit(user, 'import.' + kind, 'import/' + kind, `Imported ${accepted.length} ${kind} rows (${rejected.length} rejected)`); }
        return { accepted: accepted.length, rejected, acceptedRows: accepted.slice(0, 20) }; }
      case 'export': return { __csv: toCsv(S.actions, ['id', 'incidentId', 'type', 'station', 'region', 'title', 'pri', 'state', 'raisedAt', 'escalated']), name: 'actions.csv' };
    }
    throw nf();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const path = url.pathname;
    try {
      if (path === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(`window.__CONFIG__=${JSON.stringify({ authMode: 'dev', apiBase: '/api', env: S.env, controlUrl, version: 'test', firebase: null })};`); }
      if (path === '/__test/reset') { const env = S.env; S = createStore(); S.env = env; return send(res, 200, { ok: true }); }
      if (path === '/__test/env') { S.env = url.searchParams.get('v'); return send(res, 200, { ok: true }); }
      if (path === '/__test/state') return send(res, 200, { users: [...S.users.values()], settings: S.settings, connectors: S.connectors, probes: S.probes, apikeys: S.apikeys, audit: S.audit.slice(0, 20), works: S.works });
      if (path.startsWith('/api/')) {
        const r = await api(req, res, url, path);
        if (r?.__csv != null) { res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${r.name}"` }); return res.end(r.__csv); }
        return send(res, 200, r);
      }
      let f = join(dist, path === '/' ? 'index.html' : path.slice(1)); if (!f.startsWith(dist)) return send(res, 403, 'no');
      if (!existsSync(f) || statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      console.error(e); send(res, 500, { error: { code: 'internal', message: String(e.message) } });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => { const p = server.address().port; resolve({ url: `http://127.0.0.1:${p}`, port: p, close: () => new Promise((r) => server.close(r)), reset: () => (S = Object.assign(createStore(), { env: S.env })) }); }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock({ port: +process.argv[2] || 8787, env: process.env.ADMIN_ENV || 'local' });
  console.log(`mock admin API + site on ${m.url}\n  sign in as admin@blr.test (admin) · station.indira@blr.test (refused: non-admin) · nobody@blr.test (not allowlisted)`);
}
