/** Pure admin logic (no DOM, no imports) so it can be unit-tested in Node. */

/* ---------- projection (map.json: x=(lon-77.40)*50000, y=(lat-12.80)*50000) ---------- */
export const lonLatToXY = (lon, lat) => [(lon - 77.4) * 50000, (lat - 12.8) * 50000];
export const xyToLonLat = (x, y) => [77.4 + x / 50000, 12.8 + y / 50000];
export const METERS_PER_UNIT = 2.2;
export const BBOX = { lon: [77.3, 77.9], lat: [12.7, 13.3] };

export function nearestNode(nxy, x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nxy.length; i++) { const dx = nxy[i][0] - x, dy = nxy[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  return { node: best, dist: Math.sqrt(bd) * METERS_PER_UNIT };
}
/** Rough free-flow minutes between two map points: straight line x1.35 route factor at 38 km/h. */
export function estimateFreeMin(a, b) {
  const m = Math.hypot(a[0] - b[0], a[1] - b[1]) * METERS_PER_UNIT * 1.35;
  return Math.max(1, Math.round(m / (38000 / 60)));
}

/* ---------- CSV ---------- */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false, i = 0;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
export function csvObjects(text) {
  const [head = [], ...rest] = parseCsv(text);
  const header = head.map((h) => h.trim().toLowerCase());
  return { header, rows: rest.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
const csvCell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows, cols) { return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'; }

export const IMPORT_SPECS = {
  works: { header: ['name', 'road', 'station', 'from', 'to', 'hours', 'cap', 'kind', 'agency'], required: ['name', 'road', 'station', 'from', 'to'], example: 'name,road,station,from,to,hours,cap,kind,agency\nMetro Phase 3 barricading,Outer Ring Road,K R Puram,2026-10-15,2026-12-31,peak,0.7,metro,BMRCL\n' },
  crash: { header: ['station', 'year', 'fatal', 'nonfatal'], required: ['station', 'year', 'fatal', 'nonfatal'], example: 'station,year,fatal,nonfatal\nHalasooru,2025,12,34\n' },
};
/** Header check before we send anything to the server. Returns problem strings. */
export function checkCsvHeader(text, kind) {
  const spec = IMPORT_SPECS[kind]; const { header, rows } = csvObjects(text); const p = [];
  if (!header.length || (header.length === 1 && !header[0])) return ['The file is empty.'];
  const miss = spec.required.filter((c) => !header.includes(c));
  if (miss.length) p.push(`Missing required column${miss.length > 1 ? 's' : ''}: ${miss.join(', ')}.`);
  const unknown = header.filter((c) => !spec.header.includes(c));
  if (unknown.length) p.push(`Unknown column${unknown.length > 1 ? 's' : ''} will be ignored: ${unknown.join(', ')}.`);
  if (!rows.length) p.push('The file has a header but no data rows.');
  return p;
}

/* ---------- diff ---------- */
export function flatten(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) { const p = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out); else out[p] = v; }
  return out;
}
export function diffObjects(a, b) {
  const fa = flatten(a), fb = flatten(b), keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort(), out = [];
  for (const k of keys) if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) out.push({ path: k, from: fa[k], to: fb[k] });
  return out;
}

/* ---------- settings ---------- */
export const FEED_MODES = ['sim', 'live', 'blend'];
const isInt = (v) => Number.isInteger(v);
export function validateSettings(s) {
  const e = {};
  if (!FEED_MODES.includes(s.feed?.mode)) e['feed.mode'] = 'Choose sim, live or blend.';
  if (!isInt(s.feed?.tickMin) || s.feed.tickMin < 1 || s.feed.tickMin > 60) e['feed.tickMin'] = 'Whole minutes, 1 to 60.';
  if (!isInt(s.feed?.staleAfterMin) || s.feed.staleAfterMin < 2 || s.feed.staleAfterMin > 360) e['feed.staleAfterMin'] = 'Whole minutes, 2 to 360.';
  else if (!e['feed.tickMin'] && s.feed.staleAfterMin < s.feed.tickMin * 2) e['feed.staleAfterMin'] = 'Must be at least 2x the tick interval, or the feed is stale between healthy ticks.';
  if (s.feed && (s.feed.idleAfterMin !== undefined || s.feed.idleTickMin !== undefined)) {
    if (!isInt(s.feed.idleAfterMin) || s.feed.idleAfterMin < 0 || s.feed.idleAfterMin > 1440) e['feed.idleAfterMin'] = 'Whole minutes, 0 (never idle) to 1440.';
    if (!isInt(s.feed.idleTickMin) || s.feed.idleTickMin < 10 || s.feed.idleTickMin > 240) e['feed.idleTickMin'] = 'Whole minutes, 10 to 240.';
    else if (isInt(s.feed.tickMin) && s.feed.idleTickMin < s.feed.tickMin) e['feed.idleTickMin'] = 'Must be at least the tick interval.';
  }
  if (!isInt(s.workflow?.escalateAfterMin) || s.workflow.escalateAfterMin < 1 || s.workflow.escalateAfterMin > 240) e['workflow.escalateAfterMin'] = 'Whole minutes, 1 to 240.';
  if (!isInt(s.workflow?.verifyAfterMin) || s.workflow.verifyAfterMin < 5 || s.workflow.verifyAfterMin > 480) e['workflow.verifyAfterMin'] = 'Whole minutes, 5 to 480.';
  for (const k of ['routesCallsPerDay', 'tomtomCallsPerDay']) if (!isInt(s.caps?.[k]) || s.caps[k] < 0 || s.caps[k] > 100000) e[`caps.${k}`] = 'Whole number, 0 to 100,000.';
  const m = s.map;
  if (m) {
    if (!['traffic', 'safety', 'speed'].includes(m.defaultView)) e['map.defaultView'] = 'Choose traffic, safety or speed.';
    else if (m.defaultView !== 'traffic' && Object.values(m.views?.[m.defaultView] ?? {}).every((x) => !x)) e['map.defaultView'] = 'This view is off for every role, so it cannot be the default.';
    const b = m.speedBands ?? {}; const ks = ['slow', 'moderate', 'good', 'fast'];
    for (const k of ks) if (!isInt(b[k]) || b[k] < 3 || b[k] > 80) e[`map.speedBands.${k}`] = 'Whole km/h, 3 to 80.';
    if (!ks.some((k) => e[`map.speedBands.${k}`])) ks.slice(1).forEach((k, i) => { if (!(b[ks[i]] < b[k]) && !e[`map.speedBands.${k}`]) e[`map.speedBands.${k}`] = `Must be higher than ${ks[i]} (${b[ks[i]]}).`; });
    if (!isInt(m.crashScale) || m.crashScale < 1 || m.crashScale > 500) e['map.crashScale'] = 'Whole number, 1 to 500.';
  }
  return e;
}
export function validateAiLimits(ai) {
  const e = {};
  if (!isInt(ai.dailyCallCap) || ai.dailyCallCap < 0 || ai.dailyCallCap > 1e6) e.dailyCallCap = 'Whole number, 0 to 1,000,000.';
  for (const r of ['admin', 'commissioner', 'dcp', 'station', 'viewer']) { const v = ai.perUserDaily?.[r]; if (!isInt(v) || v < 0 || v > 10000) e[`perUserDaily.${r}`] = 'Whole number, 0 to 10,000.'; }
  for (const t of ['t1', 't2', 't3']) { const m = ai.tiers?.[t]?.model; if (ai.tiers?.[t]?.enabled && !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(m ?? '')) e[`tiers.${t}.model`] = 'Enter a model id such as gemini-2.5-flash.'; }
  return e;
}

/* ---------- secrets ---------- */
export function validateSecretRef(v, required) {
  v = String(v ?? '').trim();
  if (!v) return required ? 'A Secret Manager secret name is required.' : null;
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,254}$/.test(v)) return 'Use letters, digits, - and _ only (a Secret Manager secret id).';
  if (/^(AIza|sk-|ya29\.|ghp_|xox)/.test(v) || (v.length > 48 && /\d/.test(v) && /[A-Z]/.test(v))) return 'This looks like a key value, not a secret name. Store the key in Secret Manager and enter only its name.';
  return null;
}

/* ---------- GeoJSON ---------- */
export function validateGeoJSON(g, stationNames) {
  const errors = [], warnings = []; const seen = new Map(); let polys = 0;
  if (!g || typeof g !== 'object') return { errors: ['Not a JSON object.'], warnings, covered: [], missing: stationNames, polys: 0 };
  if (g.type !== 'FeatureCollection' || !Array.isArray(g.features)) return { errors: ['Top-level type must be "FeatureCollection" with a features array.'], warnings, covered: [], missing: stationNames, polys: 0 };
  if (!g.features.length) errors.push('The collection has no features.');
  const inBox = ([lon, lat]) => lon >= BBOX.lon[0] && lon <= BBOX.lon[1] && lat >= BBOX.lat[0] && lat <= BBOX.lat[1];
  g.features.forEach((f, i) => {
    const tag = `Feature ${i + 1}`;
    if (f?.type !== 'Feature' || !f.geometry) return errors.push(`${tag}: not a Feature with a geometry.`);
    const name = f.properties?.station;
    if (typeof name !== 'string' || !name) errors.push(`${tag}: properties.station is required.`);
    else if (!stationNames.includes(name)) errors.push(`${tag}: "${name}" is not a known station name.`);
    else if (seen.has(name)) errors.push(`${tag}: duplicate polygon for "${name}" (first at feature ${seen.get(name)}).`);
    else seen.set(name, i + 1);
    const t = f.geometry.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon') return errors.push(`${tag}: geometry must be Polygon or MultiPolygon (found ${t}).`);
    const parts = t === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!Array.isArray(parts) || !parts.length) return errors.push(`${tag}: no coordinates.`);
    for (const poly of parts) for (const ring of poly ?? []) {
      polys++;
      if (!Array.isArray(ring) || ring.length < 4) { errors.push(`${tag}: a ring has fewer than 4 points.`); continue; }
      const a = ring[0], b = ring[ring.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) errors.push(`${tag}: a ring is not closed (first and last point differ).`);
      if (ring.some((p) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) errors.push(`${tag}: a ring has a non-numeric coordinate.`);
      else if (ring.some((p) => !inBox(p))) errors.push(`${tag}: coordinates fall outside Bengaluru (lon 77.3-77.9, lat 12.7-13.3). Are they [lon, lat] and WGS84?`);
    }
  });
  const covered = [...seen.keys()], missing = stationNames.filter((n) => !seen.has(n));
  if (!errors.length && missing.length) warnings.push(`${missing.length} station${missing.length > 1 ? 's have' : ' has'} no polygon and will keep the built-in boundary: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}.`);
  return { errors: errors.slice(0, 25), moreErrors: Math.max(0, errors.length - 25), warnings, covered, missing, polys };
}

/* ---------- time ---------- */
export const IST_MS = 19800000;
export function istDayStartMs(ms = Date.now()) { return Math.floor((ms + IST_MS) / 86400000) * 86400000 - IST_MS; }
export const dateInputToMs = (s, endOfDay) => (s ? Date.parse(s + 'T00:00:00+05:30') + (endOfDay ? 86399999 : 0) : null);
export function compareHub(a, b) { return String(a).localeCompare(String(b)); }
