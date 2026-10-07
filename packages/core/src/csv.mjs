import { validDate } from './util.mjs';
import { resolveStation } from './map.mjs';

/** RFC-4180 CSV parser. Returns array of string arrays. Throws on unterminated quotes. */
export function parseCsvRows(text) {
  const rows = []; let row = [], f = '', q = false, i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (q) throw new Error('unterminated quote');
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
/** Parse with header validation. Returns {rows:[{row:<1-based line index incl. header>,data:{col:val}}], error?}. */
export function parseCsv(text, { required = [], maxRows = 5000, maxBytes = 2_000_000 } = {}) {
  if (typeof text !== 'string') return { rows: [], error: 'empty body' };
  if (text.length > maxBytes) return { rows: [], error: 'file too large' };
  let raw; try { raw = parseCsvRows(text); } catch (e) { return { rows: [], error: e.message }; }
  if (!raw.length) return { rows: [], error: 'empty file' };
  const head = raw[0].map((h) => h.trim().toLowerCase());
  const missing = required.filter((r) => !head.includes(r));
  if (missing.length) return { rows: [], error: `missing columns: ${missing.join(', ')}` };
  if (raw.length - 1 > maxRows) return { rows: [], error: `too many rows (max ${maxRows})` };
  const rows = raw.slice(1).map((r, i) => ({ row: i + 2, data: Object.fromEntries(head.map((h, k) => [h, (r[k] ?? '').trim()])) }));
  return { rows };
}
/** Neutralise spreadsheet formula injection in exported CSV. */
export function csvCell(v) {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';

export const WORK_HOURS = ['all', 'peak', 'night'];
/**
 * Validate a works record (CSV row, JSON body, connector item). Returns {ok:true,value}|{ok:false,reason}.
 * `stations` may be an array, or a string separated by | or ;.
 */
export function validateWork(r, net, { partial = false, overrides = [] } = {}) {
  const out = {}, bad = (reason) => ({ ok: false, reason });
  const has = (k) => r[k] !== undefined && r[k] !== '';
  if (!partial || has('name')) { const n = String(r.name ?? '').trim(); if (!n || n.length > 120) return bad('name required (max 120)'); out.name = n; }
  if (!partial || has('road')) { const n = String(r.road ?? '').trim(); if (!n || n.length > 120) return bad('road required (max 120)'); out.road = n; }
  if (!partial || has('station') || has('stations')) {
    const list = Array.isArray(r.stations) ? r.stations : String(r.stations ?? r.station ?? '').split(/[|;]/);
    const names = []; for (const s of list.map((x) => String(x).trim()).filter(Boolean)) { const n = resolveStation(net, s, overrides); if (!n) return bad(`unknown station "${s}"`); if (!names.includes(n)) names.push(n); }
    if (!names.length) return bad('station required'); out.stations = names;
  }
  if (!partial || has('from')) { if (!validDate(r.from)) return bad('from must be YYYY-MM-DD'); out.from = r.from; }
  if (!partial || has('to')) { if (!validDate(r.to)) return bad('to must be YYYY-MM-DD'); out.to = r.to; }
  if ((out.from ?? r.from) && (out.to ?? r.to) && (out.to ?? r.to) < (out.from ?? r.from) && !partial) return bad('to is before from');
  if (has('hours') || !partial) { const h = String(r.hours || 'all').toLowerCase(); if (!WORK_HOURS.includes(h)) return bad('hours must be all|peak|night'); out.hours = h; }
  if (!partial || has('cap')) {
    const c = typeof r.cap === 'number' ? r.cap : Number(r.cap);
    if (r.cap === '' || r.cap == null || !Number.isFinite(c) || c < 0 || c > 1) return bad('cap must be a number 0..1'); out.cap = c;
  }
  if (has('kind') || !partial) { const k = String(r.kind || 'roadwork').trim(); if (k.length > 40) return bad('kind too long'); out.kind = k; }
  if (has('agency')) { const a = String(r.agency).trim(); if (a.length > 80) return bad('agency too long'); out.agency = a; }
  return { ok: true, value: out };
}

/** Validate a crash row {station,year,fatal,nonfatal}. */
export function validateCrashRow(r, net, { now = Date.now(), overrides = [] } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  const station = resolveStation(net, r.station, overrides); if (!station) return bad(`unknown station "${r.station}"`);
  const year = Number(r.year), maxYear = new Date(now).getUTCFullYear();
  if (!/^\d{4}$/.test(String(r.year).trim()) || year < 2000 || year > maxYear) return bad(`year must be 2000..${maxYear}`);
  const num = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);
  const fatal = num(r.fatal), nonfatal = num(r.nonfatal);
  if (!(fatal >= 0 && fatal <= 100000)) return bad('fatal must be a non-negative integer');
  if (!(nonfatal >= 0 && nonfatal <= 100000)) return bad('nonfatal must be a non-negative integer');
  return { ok: true, value: { station, year, fatal, nonfatal } };
}

/** Parse + validate a works CSV. Returns {accepted:[valid values], rejected:[{row,reason}], error?}. */
export function importWorksCsv(text, net, opts = {}) {
  const p = parseCsv(text, { required: ['name', 'road', 'station', 'from', 'to', 'cap'], ...opts });
  if (p.error) return { accepted: [], rejected: [], error: p.error };
  return validateWorkRows(p.rows, net, opts);
}
export function validateWorkRows(rows, net, opts = {}) {
  const accepted = [], rejected = [];
  for (const { row, data } of rows) { const v = validateWork(data, net, opts); if (v.ok) accepted.push(v.value); else rejected.push({ row, reason: v.reason }); }
  return { accepted, rejected };
}
export function importCrashCsv(text, net, opts = {}) {
  const p = parseCsv(text, { required: ['station', 'year', 'fatal', 'nonfatal'], ...opts });
  if (p.error) return { accepted: [], rejected: [], error: p.error };
  return validateCrashRows(p.rows, net, opts);
}
export function validateCrashRows(rows, net, opts = {}) {
  const accepted = [], rejected = [], seen = new Set();
  for (const { row, data } of rows) {
    const v = validateCrashRow(data, net, opts);
    if (!v.ok) { rejected.push({ row, reason: v.reason }); continue; }
    const k = `${v.value.station}|${v.value.year}`;
    if (seen.has(k)) { rejected.push({ row, reason: 'duplicate station+year in file' }); continue; }
    seen.add(k); accepted.push(v.value);
  }
  return { accepted, rejected };
}
/** Apply accepted crash rows to crash_stats docs (merging with existing). */
export async function applyCrash(store, accepted, { now, source }) {
  const by = new Map(); for (const r of accepted) (by.get(r.station) ?? by.set(r.station, []).get(r.station)).push(r);
  for (const [station, rows] of by) {
    await store.update('crash_stats', station, (cur) => {
      const d = cur ?? { station, y2025: { fatal: 0, nonfatal: 0 }, hist: {} };
      const hist = { ...d.hist }; let y2025 = d.y2025;
      for (const r of rows) { if (r.year === 2025) y2025 = { fatal: r.fatal, nonfatal: r.nonfatal }; hist[String(r.year)] = [r.fatal, r.nonfatal]; }
      return { ...d, station, y2025, hist, source, importedAt: now };
    });
  }
  return by.size;
}
/** Persist validated works as works/{id}. id derives from content so re-imports update rather than duplicate. */
export async function applyWorks(store, accepted, { now, source, by, idPrefix = 'w-csv' }) {
  const { sha256 } = await import('./util.mjs');
  for (const w of accepted) {
    const id = `${idPrefix}-${sha256(`${w.name}|${w.road}|${w.stations.join(',')}|${w.from}`).slice(0, 12)}`;
    await store.update('works', id, (cur) => ({ ...w, id, source, active: cur?.active ?? true, by, createdAt: cur?.createdAt ?? now }));
  }
  return accepted.length;
}
