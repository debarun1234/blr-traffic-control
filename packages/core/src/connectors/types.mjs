import { err } from '../errors.mjs';
import { istDay, isObj, redact, sha256 } from '../util.mjs';
import { items, pick, validPath } from './jsonpath.mjs';
import { parseCsv, validateWorkRows, validateCrashRows, applyCrash, applyWorks } from '../csv.mjs';
import { validateEvents, upsertEvents } from '../ingest.mjs';
import { nodeLatLon } from '../map.mjs';

export const CONNECTOR_TYPES = ['sim', 'rest', 'webhook', 'csv', 'google_routes', 'tomtom', 'gba_works', 'opencity_crash'];
export const PAID = ['google_routes', 'tomtom'];
const SECRETISH = /(secret|password|passwd|token|apikey|api_key|authorization|bearer|private_?key)/i;

/** Atomically count one outbound call against a per-day counter; returns false once `cap` is reached. */
export async function takeCall(store, name, now, cap) {
  const day = istDay(now), id = `${name}-${day}`; let ok = false;
  await store.update('counters', id, (cur) => {
    const calls = cur?.calls ?? 0; if (calls >= cap) return undefined;
    ok = true; return { id, name, date: day, calls: calls + 1, expireAt: now + 3 * 86400000 };
  });
  return ok;
}
export async function callsToday(store, name, now) { return (await store.get('counters', `${name}-${istDay(now)}`))?.calls ?? 0; }

function noSecretsInConfig(c, path = 'config', errors = []) {
  for (const [k, v] of Object.entries(c ?? {})) {
    if (SECRETISH.test(k)) errors.push(`${path}.${k}: secrets must not be stored in config; use secretRef`);
    else if (isObj(v)) noSecretsInConfig(v, `${path}.${k}`, errors);
  }
  return errors;
}
const urlErr = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? null : 'url must be http(s)'; } catch { return 'url is not valid'; } };

async function secretOf(c, ctx) {
  if (!c.secretRef) throw err('invalid', 'secretRef is required');
  const v = await ctx.secretReader?.(c.secretRef);
  if (!v) throw err('unavailable', 'Secret could not be read');
  return v;
}
async function call(ctx, c, name, cap) {
  if (!(await takeCall(ctx.store, `conn-${c.id}`, ctx.now, c.dailyCap ?? Infinity))) throw err('quota_exceeded', 'Connector daily cap reached');
  if (name && !(await takeCall(ctx.store, name, ctx.now, cap))) throw err('quota_exceeded', `Global daily cap for ${name} reached`);
}

// ---------- tabular (csv, gba_works, opencity_crash) ----------
function tabularRows(text, cfg) {
  let raw;
  if ((cfg.format ?? 'csv') === 'json') {
    let j; try { j = JSON.parse(text); } catch { throw err('invalid', 'Response is not JSON'); }
    raw = items(j, cfg.itemsPath ?? '$').filter(isObj).map((o, i) => ({ row: i + 1, data: o }));
  } else {
    const p = parseCsv(text, { maxRows: 5000 }); if (p.error) throw err('invalid', p.error);
    raw = p.rows;
  }
  const ren = Object.fromEntries(Object.entries(cfg.columns ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return raw.map(({ row, data }) => ({ row, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [ren[k.toLowerCase()] ?? k.toLowerCase(), typeof v === 'string' ? v.trim() : v])) }));
}
function validateObsRows(rows, ctx) {
  const accepted = [], rejected = [];
  for (const { row, data } of rows) {
    const m = Number(data.minutes), at = data.at ? Number(data.at) : ctx.now;
    if (!data.probeid && !data.probeId) rejected.push({ row, reason: 'probeId required' });
    else if (!(m > 0.2 && m <= 600)) rejected.push({ row, reason: 'minutes must be 0.2..600' });
    else if (!Number.isFinite(at)) rejected.push({ row, reason: 'bad at' });
    else accepted.push({ probeId: String(data.probeid ?? data.probeId), minutes: m, at: Math.round(at) });
  }
  return { accepted, rejected };
}
function tabularType(fixedTarget) {
  return {
    needsSecret: false,
    validateConfig(c) {
      const e = []; if (!c.url || urlErr(c.url)) e.push(urlErr(c.url ?? '') ?? 'url required');
      if (c.format && !['csv', 'json'].includes(c.format)) e.push('format must be csv|json');
      if (c.itemsPath && !validPath(c.itemsPath)) e.push('itemsPath invalid');
      const t = fixedTarget ?? c.target; if (!['works', 'crash', 'observations'].includes(t)) e.push('target must be works|crash|observations');
      return e;
    },
    async fetchData(c, ctx) {
      const target = fixedTarget ?? c.config.target;
      await call(ctx, c);
      const r = await ctx.fetch(c.config.url, { headers: await authHeaders(c, ctx), method: 'GET' }, { maxBytes: c.config.maxBytes, timeoutMs: c.config.timeoutMs });
      if (!r.ok) throw err('unavailable', `HTTP ${r.status}`);
      const rows = tabularRows(r.text, c.config);
      const v = target === 'works' ? validateWorkRows(rows, ctx.net) : target === 'crash' ? validateCrashRows(rows, ctx.net, { now: ctx.now }) : validateObsRows(rows, ctx);
      return { kind: target, rows: v.accepted, rejected: v.rejected, total: rows.length };
    },
  };
}
async function authHeaders(c, ctx) {
  const h = { accept: 'application/json, text/csv', ...(c.config.headers ?? {}) };
  if (c.secretRef) { const s = await secretOf(c, ctx); ctx.secret = s; if (c.config.authHeader) h[c.config.authHeader] = s; else h.authorization = `Bearer ${s}`; }
  return h;
}

// ---------- rest ----------
const REST_INC = ['externalId', 'type', 'durationMin'], REST_OBS = ['probeId', 'minutes'];
const rest = {
  needsSecret: false,
  validateConfig(c) {
    const e = noSecretsInConfig(c); if (!c.url || urlErr(c.url)) e.push(urlErr(c.url ?? '') ?? 'url required');
    if (c.method && !['GET', 'POST'].includes(c.method)) e.push('method must be GET|POST');
    if (!['incidents', 'observations'].includes(c.target)) e.push('target must be incidents|observations');
    if (c.itemsPath && !validPath(c.itemsPath)) e.push('itemsPath invalid');
    if (!isObj(c.map)) e.push('map required'); else {
      for (const [k, v] of Object.entries(c.map)) if (typeof v === 'string' ? !validPath(v) : !(isObj(v) && 'const' in v)) e.push(`map.${k} must be a $-path or {const}`);
      const need = c.target === 'observations' ? REST_OBS : REST_INC; for (const k of need) if (!(k in c.map)) e.push(`map.${k} required`);
      if (c.target === 'incidents' && !('edge' in c.map || ('lat' in c.map && 'lon' in c.map))) e.push('map.edge or map.lat+map.lon required');
    }
    if (c.timeoutMs !== undefined && !(c.timeoutMs >= 500 && c.timeoutMs <= 30000)) e.push('timeoutMs 500..30000');
    if (c.maxBytes !== undefined && !(c.maxBytes >= 1000 && c.maxBytes <= 5_000_000)) e.push('maxBytes 1000..5000000');
    for (const k of Object.keys(c.headers ?? {})) if (/^(authorization|x-api-key|cookie|proxy-authorization)$/i.test(k)) e.push(`headers.${k}: use secretRef`);
    return e;
  },
  async fetchData(c, ctx) {
    const cfg = c.config; await call(ctx, c);
    const init = { method: cfg.method ?? 'GET', headers: await authHeaders(c, ctx) };
    if (init.method === 'POST' && cfg.body !== undefined) { init.body = JSON.stringify(cfg.body); init.headers['content-type'] = 'application/json'; }
    const r = await ctx.fetch(cfg.url, init, { maxBytes: cfg.maxBytes, timeoutMs: cfg.timeoutMs });
    if (!r.ok) throw err('unavailable', `HTTP ${r.status}`);
    let j; try { j = r.json(); } catch { throw err('invalid', 'Response is not JSON'); }
    const list = items(j, cfg.itemsPath ?? '$').slice(0, 2000);
    const mapped = list.map((it) => Object.fromEntries(Object.keys(cfg.map).map((k) => [k, pick(it, cfg.map[k])])));
    if (cfg.target === 'observations') {
      const v = validateObsRows(mapped.map((d, i) => ({ row: i + 1, data: d })), ctx);
      return { kind: 'observations', rows: v.accepted, rejected: v.rejected, total: mapped.length };
    }
    const v = validateEvents(ctx.net, mapped, ctx.now);
    return { kind: 'incidents', rows: v.valid, rejected: v.rejected.map((x) => ({ row: x.index + 1, reason: x.reason })), total: mapped.length };
  },
};

// ---------- google_routes / tomtom ----------
const latlng = (net, node) => { const p = nodeLatLon(net, node); return { latitude: +p.lat.toFixed(6), longitude: +p.lon.toFixed(6) }; };
async function probeLoop(c, ctx, limit, one) {
  const probes = (await ctx.store.list('probes', { where: [['enabled', '==', true]] })).slice(0, limit ?? 500);
  const rows = [], rejected = []; let calls = 0, firstErr = null;
  for (const p of probes) {
    try { const minutes = await one(p); calls++; if (minutes > 0) rows.push({ probeId: p.id, minutes: Math.round(minutes * 100) / 100, at: ctx.now }); }
    catch (e) { if (e.code === 'quota_exceeded') { firstErr ??= e; break; } firstErr ??= e; rejected.push({ row: p.id, reason: redact(e.message, [ctx.secret]) }); }
  }
  if (!rows.length && probes.length && firstErr) throw firstErr;
  return { kind: 'observations', rows, rejected, total: probes.length, cost: { calls } };
}
const google_routes = {
  needsSecret: true,
  validateConfig(c) { return noSecretsInConfig(c); },
  async fetchData(c, ctx, { limit } = {}) {
    ctx.secret = await secretOf(c, ctx);
    return probeLoop(c, ctx, limit, async (p) => {
      await call(ctx, c, 'routes', ctx.settings.caps.routesCallsPerDay);
      const r = await ctx.fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.secret, 'x-goog-fieldmask': 'routes.duration,routes.staticDuration' },
        body: JSON.stringify({ origin: { location: { latLng: latlng(ctx.net, p.fromNode) } }, destination: { location: { latLng: latlng(ctx.net, p.toNode) } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
      }, { timeoutMs: c.config.timeoutMs });
      if (!r.ok) throw err('unavailable', `Routes API HTTP ${r.status}`);
      const d = r.json()?.routes?.[0]?.duration, s = /^(\d+(?:\.\d+)?)s$/.exec(String(d ?? ''));
      if (!s) throw err('invalid', 'No duration in Routes API response');
      return Number(s[1]) / 60;
    });
  },
};
const tomtom = {
  needsSecret: true,
  validateConfig(c) { return noSecretsInConfig(c); },
  async fetchData(c, ctx, { limit } = {}) {
    ctx.secret = await secretOf(c, ctx);
    return probeLoop(c, ctx, limit, async (p) => {
      await call(ctx, c, 'tomtom', ctx.settings.caps.tomtomCallsPerDay);
      const a = latlng(ctx.net, p.fromNode), b = latlng(ctx.net, p.toNode);
      const r = await ctx.fetch(`https://api.tomtom.com/routing/1/calculateRoute/${a.latitude},${a.longitude}:${b.latitude},${b.longitude}/json?traffic=true&travelMode=car&routeType=fastest&key=${encodeURIComponent(ctx.secret)}`, { method: 'GET' }, { timeoutMs: c.config.timeoutMs });
      if (!r.ok) throw err('unavailable', `TomTom HTTP ${r.status}`);
      const sec = r.json()?.routes?.[0]?.summary?.travelTimeInSeconds;
      if (!(sec > 0)) throw err('invalid', 'No travel time in TomTom response');
      return sec / 60;
    });
  },
};
const none = (note) => ({ needsSecret: false, validateConfig: (c) => (Object.keys(c ?? {}).length ? ['config must be empty for this type'] : []), async fetchData() { return { kind: 'none', rows: [], rejected: [], total: 0, note }; } });

export const REGISTRY = {
  sim: none('Simulated feed marker: no external data. The feed mode in settings selects simulated incidents.'),
  webhook: none('Documentation only: external systems push to /ingest/v1/* with an API key.'),
  csv: tabularType(null), gba_works: tabularType('works'), opencity_crash: tabularType('crash'), rest, google_routes, tomtom,
};
/** Required shape: {validateConfig, test, run}. test never writes. run persists unless shadow. */
for (const t of Object.values(REGISTRY)) {
  t.test = async (c, ctx) => { const d = await t.fetchData(c, ctx, { limit: 1 }); return { sample: d.rows.slice(0, 3), kind: d.kind, count: d.rows.length, rejected: d.rejected.slice(0, 5), cost: d.cost, note: d.note }; };
  t.run = async (c, ctx) => {
    const d = await t.fetchData(c, ctx, {}); const shadow = c.mode === 'shadow';
    let n = d.rows.length;
    if (d.rows.length === 0 && d.rejected?.length && d.total > 0) throw err('invalid', `All ${d.total} rows rejected; first: ${d.rejected[0].reason}`);
    if (!shadow) n = await persist(d, c, ctx);
    return { count: n, cost: d.cost, shadow, rejected: d.rejected?.length ?? 0 };
  };
}
async function persist(d, c, ctx) {
  const by = `connector:${c.id}`;
  if (d.kind === 'incidents') { await upsertEvents(ctx.store, d.rows, { idFor: (x) => `c-${c.id}-${x}`, src: 'connector', by, connectorId: c.id, now: ctx.now }); return d.rows.length; }
  if (d.kind === 'observations') {
    let n = 0; const probes = new Map();
    for (const o of d.rows) {
      if (!probes.has(o.probeId)) probes.set(o.probeId, !!(await ctx.store.get('probes', o.probeId)));
      if (!probes.get(o.probeId)) continue;
      const id = `${o.probeId}_${o.at}`; await ctx.store.set('probe_obs', id, { id, probeId: o.probeId, at: o.at, minutes: o.minutes, source: by, expireAt: ctx.now + 7 * 86400000 }); n++;
    }
    return n;
  }
  if (d.kind === 'works') return applyWorks(ctx.store, d.rows, { now: ctx.now, source: 'connector', by, idPrefix: `w-c-${sha256(c.id).slice(0, 6)}` });
  if (d.kind === 'crash') { await applyCrash(ctx.store, d.rows, { now: ctx.now, source: by }); return d.rows.length; }
  return 0;
}
