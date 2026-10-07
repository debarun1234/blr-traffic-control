import { createHash, randomBytes } from 'node:crypto';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const rid = (n = 6) => randomBytes(n).toString('hex');
export const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const pad = (n, w = 2) => String(n).padStart(w, '0');
const DAY = 86400000, IST = 19800000;
/** yyyyMMdd (IST) */
export const istDay = (ms) => new Date(ms + IST).toISOString().slice(0, 10).replace(/-/g, '');
/** yyyyMMddHHmm (IST) */
export const istMinuteKey = (ms) => new Date(ms + IST).toISOString().slice(0, 16).replace(/[-T:]/g, '');
export const istHourKey = (ms) => new Date(ms + IST).toISOString().slice(0, 13).replace(/[-T]/g, '');
export const nextIstMidnight = (ms) => Math.floor((ms + IST) / DAY + 1) * DAY - IST;
export const isoDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
export const shiftDate = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const validDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; };
/** Deterministic JSON (sorted keys) for cache keys. */
export function stable(x) {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',')}}`;
  return JSON.stringify(x ?? null);
}
export function deepMerge(base, patch) {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** Remove secrets from strings that might reach logs/errors. */
export function redact(s, secrets = []) {
  let out = String(s ?? '');
  for (const sec of secrets) if (sec && String(sec).length >= 4) out = out.split(String(sec)).join('***');
  return out.replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, '$1***');
}
