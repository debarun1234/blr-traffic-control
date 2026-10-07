// In-memory implementation of docs/api-contract.md (the parts the Control app uses), plus a static server for
// apps/control/dist. AUTH_MODE=dev only (x-dev-user). Run standalone: node test/mock-api.mjs [port]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNetwork, assign, encodeState, simIncidents, INCIDENT_TYPES } from '../../../packages/model/src/index.mjs';
import { loadMap } from '../../../packages/mapdata/index.mjs';
import { PERMISSIONS, jurisdiction, lockedRegion, canTransition, hasPermission, actionIdFor, istParts } from '../../../packages/shared/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FIXED_NOW = Date.parse('2026-10-07T03:30:00Z'); // 09:00 IST
const CRASH = JSON.parse(readFileSync(join(here, '..', '..', '..', 'packages', 'mapdata', 'crash.json'), 'utf8'));

export async function startMock({ port = 0, pollMs = 30000, hour = 9.0, date = '2026-10-07', log = false } = {}) {
  const map = loadMap(), net = createNetwork(map), stations = map.st.map((s) => ({ n: s.n, r: s.r }));
  const stIdx = new Map(map.st.map((s, i) => [s.n, i]));
  const DEFAULT_USERS = [
    { email: 'admin@example.test', name: 'Asha Admin', role: 'admin' },
    { email: 'commissioner@example.test', name: 'Chandra Commissioner', role: 'commissioner' },
    { email: 'north.dcp@example.test', name: 'Nandini DCP', role: 'dcp', region: 'North' },
    { email: 'yalahanka@example.test', name: 'Yash Yalahanka', role: 'station', station: 'Yalahanka' },
    { email: 'indiranagar@example.test', name: 'Indu Indiranagar', role: 'station', station: 'Indiranagar' },
    { email: 'viewer@example.test', name: 'Vik Viewer', role: 'viewer' },
  ];
  let S;
  const edgeIn = (stName, nth = 0) => { const si = stIdx.get(stName); let k = 0; for (let e = 0; e < net.ne; e++) if (net.stn[e] === si && net.name[e] >= 0 && net.cls[e] <= 1 && net.len[e] > 150) { if (k++ === nth) return e; } throw new Error('no edge in ' + stName); };
  const mkInc = (id, type, e, sh, eh, src = 'sim', by) => ({ id, src, type, edge: e, station: map.st[net.stn[e]].n, date, startHour: sh, endHour: eh, cap: (INCIDENT_TYPES.find((x) => x.type === type) ?? { cap: 0.5 }).cap, by, createdAt: FIXED_NOW });
  function init() {
    S = {
      now: FIXED_NOW, hour, date, boost: 1.12, mode: 'sim', stale: false, staleBy: 0, maintenance: false, aiEnabled: true, aiLimit: 50, aiUsed: 0, down: null, latency: 0, version: 1, seq: 100,
      users: new Map(DEFAULT_USERS.map((u) => [u.email, { active: true, ...u }])), actions: new Map(), aiCache: new Map(), calls: [],
      incidents: [...simIncidents(net, date).map((x) => mkInc(x.id, x.type, x.e, x.sh, x.eh)),
        mkInc(`${date}-s1`, 'Vehicle breakdown', edgeIn('Yalahanka'), hour - 0.1, hour + 0.7), mkInc(`${date}-s2`, 'Accident', edgeIn('Indiranagar'), hour - 0.5, hour + 0.8),
        mkInc(`${date}-s3`, 'Signal fault', edgeIn('Halasooru'), hour - 0.4, hour + 0.6), mkInc(`${date}-s4`, 'Waterlogging', edgeIn('Peenya'), hour - 0.35, hour + 0.9)],
      works: [
        { id: 'w1', name: 'Metro viaduct works, ORR', road: 'Outer Ring Road', stations: ['Bellanduru', 'Mahadevapura'], from: '2026-09-01', to: '2027-06-30', hours: 'all', cap: 0.75, kind: 'Metro', agency: 'BMRCL', source: 'manual', active: true, by: 'admin@example.test', createdAt: FIXED_NOW },
        { id: 'w2', name: 'Storm-water drain remodelling, ORR', road: 'Outer Ring Road', stations: ['Bellanduru'], from: '2026-10-01', to: '2026-12-31', hours: 'all', cap: 0.7, kind: 'Drain', agency: 'GBA', source: 'csv', active: true, by: 'admin@example.test', createdAt: FIXED_NOW },
        { id: 'w3', name: 'Utility trench, Tumkur Road', road: 'Tumkur Road', stations: ['Peenya'], from: '2026-10-01', to: '2026-11-30', hours: 'all', cap: 0.75, kind: 'Utility', agency: 'BESCOM', source: 'manual', active: true, by: 'admin@example.test', createdAt: FIXED_NOW },
      ],
    };
    syncActions(); recompute(3);
  }
  const roadName = (e) => (net.name[e] >= 0 ? map.n[net.name[e]] : 'unnamed road');
  function syncActions() {
    for (const inc of S.incidents) {
      if (inc.date !== S.date || !(inc.startHour <= S.hour && S.hour < inc.endHour + 1.5)) continue;
      const id = actionIdFor(inc.id), si = stIdx.get(inc.station);
      const ex = S.actions.get(id);
      const base = { id, incidentId: inc.id, type: 'inc', edge: inc.edge, station: inc.station, region: map.st[si].r, title: `${inc.type} on ${roadName(inc.edge)}`, detail: `${inc.type} reported near ${roadName(inc.edge)} (${inc.station}). Capacity reduced to ${Math.round(inc.cap * 100)}%.`, pri: inc.cap < 0.5 ? 'hi' : 'md', raisedHour: inc.startHour, raisedAt: S.now - (S.hour - inc.startHour) * 3600e3, date: S.date };
      if (!ex) S.actions.set(id, { ...base, state: 'new', escalated: (S.hour - inc.startHour) * 60 > 15, escalatedAt: undefined });
      else if (ex.state === 'new') ex.escalated = (S.hour - inc.startHour) * 60 > 15;
    }
  }
  function capMul() {
    const cm = new Float32Array(net.ne).fill(1); let any = false;
    for (const x of S.incidents) if (x.date === S.date && x.startHour <= S.hour && S.hour < x.endHour) { cm[x.edge] = Math.min(cm[x.edge], x.cap); any = true; }
    return any ? cm : null;
  }
  let cur = null;
  function recompute(iters = 3) {
    const r = assign(net, { t: S.hour, capMul: capMul(), boost: S.boost, iters }), enc = encodeState(r);
    let vk = 0, vs = 0, L = 0, cl = 0; for (let e = 0; e < net.ne; e++) { const f = Math.max(r.flow[2 * e], r.flow[2 * e + 1]), l = net.len[e] / 1000; vk += f * l; vs += f * l * r.spd[e]; L += l; if (r.vc[e] > 0.95) cl += l; }
    const per = map.st.map((s, i) => { let a = 0, b = 0, c = 0, d = 0; for (let e = 0; e < net.ne; e++) if (net.stn[e] === i) { const f = Math.max(r.flow[2 * e], r.flow[2 * e + 1]), l = net.len[e] / 1000; a += f * l; b += f * l * r.spd[e]; c += l; if (r.vc[e] > 0.95) d += l; } return { i, speed: a ? b / a : 0, cong: c ? (100 * d) / c : 0 }; });
    cur = { vc: enc.vc, spd: enc.spd, n: enc.n, city: { speed: vk ? vs / vk : 0, congPct: L ? (100 * cl) / L : 0 }, stations: per };
    S.version++;
  }
  const stateBody = () => ({
    t: S.now, hour: S.hour, date: S.date, mode: S.mode, boost: S.boost, stale: S.stale, updatedAt: S.now - S.staleBy * 60000, net: { edges: net.ne, mapVersion: 'mock' },
    city: cur.city, stations: cur.stations, vc: cur.vc, spd: cur.spd,
    incidents: S.incidents.filter((x) => x.date === S.date && x.startHour <= S.hour && S.hour < x.endHour).map((x) => ({ id: x.id, type: x.type, edge: x.edge, station: stIdx.get(x.station), startHour: x.startHour, endHour: x.endHour, cap: x.cap, src: x.src })),
    works: S.works.filter((w) => w.active && w.from <= S.date && S.date <= w.to).map((w) => ({ id: w.id, name: w.name, road: w.road, stations: w.stations, cap: w.cap })),
    calibration: S.noCalibration ? undefined : { rmsePct: 9.1, probes: 14, at: S.now - 600000 },
  });

  const json = (res, code, body, headers = {}) => { const s = JSON.stringify(body); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(s); };
  const err = (res, code, status, message) => json(res, status, { error: { code, message } });
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
  const userOf = (req) => {
    const e = String(req.headers['x-dev-user'] ?? '').trim().toLowerCase(); if (!e) return { status: 401 };
    const u = S.users.get(e); if (!u || !u.active) return { status: 403, email: e };
    return { u };
  };
  const meOf = (u) => ({ email: u.email, name: u.name, role: u.role, region: u.region ?? null, station: u.station ?? null, active: u.active, permissions: PERMISSIONS[u.role] ?? [], lockedRegion: lockedRegion(u, stations), jurisdiction: [...jurisdiction(u, stations)], flags: { aiEnabled: S.aiEnabled, maintenance: S.maintenance } });
  const actionsFor = (u) => [...S.actions.values()].filter((a) => (u.role === 'station' || u.role === 'dcp') ? a.region === lockedRegion(u, stations) : true).sort((a, b) => (b.escalated - a.escalated) || (b.raisedAt - a.raisedAt));

  async function api(req, res, url) {
    const path = url.pathname.slice(4), m = req.method;
    if (S.down === '503') return err(res, 'unavailable', 503, 'service unavailable');
    if (S.latency) await new Promise((r) => setTimeout(r, S.latency));
    const au = userOf(req);
    if (au.status === 401) return err(res, 'unauthenticated', 401, 'sign in required');
    if (au.status === 403) return err(res, 'forbidden', 403, 'not on the allowlist');
    const u = au.u; S.calls.push(`${m} ${path}`);
    if (S.maintenance && u.role !== 'admin' && path !== '/me') return err(res, 'unavailable', 503, 'maintenance');
    if (m === 'GET' && path === '/me') return json(res, 200, meOf(u));
    if (m === 'GET' && path === '/state') {
      const et = `W/"${S.version}"`; if (req.headers['if-none-match'] === et) { res.writeHead(304, { etag: et }); return res.end(); }
      return json(res, 200, stateBody(), { etag: et });
    }
    if (m === 'GET' && path === '/crash') {
      const st = {}; map.st.forEach((s) => { st[s.n] = { station: s.n, y2025: { fatal: s.f, nonfatal: s.t }, hist: CRASH.hist[s.n] ?? {}, source: 'btp' }; });
      return json(res, 200, { stations: st, importedAt: FIXED_NOW });
    }
    if (m === 'GET' && path === '/actions') return json(res, 200, { actions: actionsFor(u).slice(0, +url.searchParams.get('limit') || 200) });
    let mm;
    if (m === 'POST' && (mm = /^\/actions\/([^/]+)\/transition$/.exec(path))) {
      const a = S.actions.get(decodeURIComponent(mm[1])); if (!a) return err(res, 'not_found', 404, 'no such action');
      const b = await body(req);
      if (!hasPermission(u, 'action.transition') || !jurisdiction(u, stations).has(a.station)) return err(res, 'forbidden', 403, 'outside your jurisdiction');
      if (!['ack', 'prog', 'done'].includes(b.to) || !canTransition(a.state, b.to)) return err(res, 'conflict', 409, `cannot go ${a.state} -> ${b.to}`);
      if (S.failNext) { S.failNext = false; return err(res, 'unavailable', 503, 'simulated failure'); }
      a.state = b.to; const t = S.now; if (b.to === 'ack') { a.ackAt = t; a.ackBy = u.email; } if (b.to === 'prog') a.progAt = t; if (b.to === 'done') { a.doneAt = t; a.doneBy = u.email; }
      return json(res, 200, a);
    }
    if (m === 'GET' && path === '/incidents') return json(res, 200, { incidents: S.incidents.filter((x) => x.date === (url.searchParams.get('date') || S.date)) });
    if (m === 'POST' && path === '/incidents') {
      const b = await body(req); const e = b.edge;
      if (!hasPermission(u, 'incident.report')) return err(res, 'forbidden', 403, 'cannot report');
      if (!Number.isInteger(e) || e < 0 || e >= net.ne || !INCIDENT_TYPES.some((x) => x.type === b.type) || !(b.durationMin >= 10 && b.durationMin <= 240)) return err(res, 'invalid', 400, 'invalid incident');
      if (!jurisdiction(u, stations).has(map.st[net.stn[e]].n)) return err(res, 'forbidden', 403, 'outside your jurisdiction');
      const inc = mkInc(`u-${++S.seq}`, b.type, e, S.hour, S.hour + b.durationMin / 60, 'user', u.email); inc.note = b.note; S.incidents.push(inc); syncActions();
      return json(res, 201, { ...inc, action: S.actions.get(actionIdFor(inc.id)) });
    }
    if (m === 'GET' && path === '/works') return json(res, 200, { works: S.works });
    if (path === '/works' || /^\/works\//.test(path)) {
      if (!hasPermission(u, 'works.write')) { await body(req); return err(res, 'forbidden', 403, 'works.write required'); }
      if (m === 'POST' && path === '/works') {
        const b = await body(req);
        if (!b.name || !b.road || !Array.isArray(b.stations) || !b.from || !b.to || !(b.cap >= 0 && b.cap <= 1)) return err(res, 'invalid', 400, 'invalid works');
        const w = { id: `w${++S.seq}`, source: 'manual', active: true, by: u.email, createdAt: S.now, hours: 'all', kind: 'Other', ...b }; S.works.push(w); return json(res, 201, w);
      }
      const wm = /^\/works\/([^/]+)$/.exec(path), w = wm && S.works.find((x) => x.id === decodeURIComponent(wm[1]));
      if (!w) return err(res, 'not_found', 404, 'no such works');
      if (m === 'PATCH') { Object.assign(w, await body(req)); return json(res, 200, w); }
      if (m === 'DELETE') { w.active = false; return json(res, 200, w); }
    }
    if (m === 'GET' && path === '/ai/quota') return json(res, 200, { used: S.aiUsed, limit: S.aiLimit, resetsAt: S.now + 6 * 3600e3, aiEnabled: S.aiEnabled });
    if (m === 'POST' && (path === '/ai/advise' || path === '/ai/brief')) {
      const b = await body(req), brief = path === '/ai/brief';
      if (!hasPermission(u, brief ? 'ai.brief' : 'ai.advise')) return err(res, 'forbidden', 403, 'no AI permission');
      if (!S.aiEnabled) return err(res, 'unavailable', 503, 'ai disabled');
      const key = path + JSON.stringify(b), hit = S.aiCache.get(key);
      if (hit) return json(res, 200, { ...hit, cached: true });
      if (S.aiUsed >= S.aiLimit) return err(res, 'quota_exceeded', 429, 'daily AI quota exceeded');
      S.aiUsed++;
      const out = brief
        ? { text: `Briefing for ${b.scope}\n- ${S.incidents.filter((x) => x.startHour <= S.hour && S.hour < x.endHour).length} incidents active; <img src=x onerror="window.__xss=1"> must stay inert text.\n- Escalated actions need acknowledgement first.\n- Morning peak speeds are modelled, not measured.`, tier: 't3', cached: false, generatedAt: S.now }
        : { text: `Deploy staff at ${b.context?.road} (${b.context?.station}). ${b.context?.alternate ? `Divert via ${b.context.alternate.road}.` : 'No clear alternate found.'} <b>bold?</b> stays text.`, tier: b.context?.road ? 't2' : 't0', cached: false, model: 'mock-model' };
      S.aiCache.set(key, out); return json(res, 200, out);
    }
    return err(res, 'not_found', 404, 'unknown endpoint ' + m + ' ' + path);
  }

  async function control(req, res, url) {
    const b = await body(req), p = url.pathname;
    if (p === '/__mock/reset') { init(); return json(res, 200, { ok: true }); }
    if (p === '/__mock/set') {
      let re = false;
      for (const k of ['boost', 'hour', 'mode', 'stale', 'staleBy', 'maintenance', 'aiEnabled', 'aiLimit', 'aiUsed', 'down', 'latency', 'failNext', 'noCalibration']) if (k in b) { S[k] = b[k]; if (k === 'boost' || k === 'hour') re = true; }
      if (b.addUser) S.users.set(b.addUser.email, { active: true, ...b.addUser });
      if (b.addIncident) { const i = b.addIncident; S.incidents.push(mkInc(i.id ?? `x-${++S.seq}`, i.type ?? 'Accident', i.edge ?? edgeIn(i.station), i.sh ?? S.hour - 0.2, i.eh ?? S.hour + 0.8)); re = true; }
      syncActions(); if (re) recompute(3); else S.version++;
      return json(res, 200, { ok: true, version: S.version });
    }
    if (p === '/__mock/info') return json(res, 200, { calls: S.calls, actions: [...S.actions.values()], works: S.works, aiUsed: S.aiUsed, edgeIn: Object.fromEntries(['Yalahanka', 'Indiranagar', 'Halasooru', 'Peenya', 'Airport'].map((n) => [n, edgeIn(n)])), cityCong: cur.city, version: S.version });
    return json(res, 404, {});
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/__mock/')) return await control(req, res, url);
      if (url.pathname.startsWith('/api/')) { if (S.down === 'drop') return req.socket.destroy(); return await api(req, res, url); }
      if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`window.__CONFIG__={authMode:'dev',apiBase:'/api',pollMs:${pollMs},adminUrl:'/admin/'};`); }
      if (url.pathname.startsWith('/admin')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Admin</title><h1>Admin site placeholder</h1>'); }
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''); if (p === '/' || p === '\\') p = '/index.html';
      const f = join(DIST, p);
      if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(readFileSync(f));
    } catch (e) { if (log) console.error(e); try { json(res, 500, { error: { code: 'internal', message: String(e) } }); } catch { /* closed */ } }
  });
  init();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ctl = async (path, payload = {}) => (await fetch(url + '/__mock/' + path, { method: 'POST', body: JSON.stringify(payload) })).json();
  const info = async () => (await fetch(url + '/__mock/info')).json();
  return { url, port: server.address().port, ctl, info, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }), FIXED_NOW };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock({ port: +process.argv[2] || 8787, log: true });
  console.log('mock API + dist on', m.url);
}
