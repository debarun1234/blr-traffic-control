import { err, isObj } from '@blr/core';

export const bad = (m) => { throw err('invalid', m); };
export function body(req) {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (!isObj(b)) bad('body must be a JSON object');
  return b;
}
export function only(b, allowed) {
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) bad(`unknown field(s): ${extra.join(', ')}`);
  return b;
}
export function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return undefined; bad(`${name} is required`); }
  if (typeof v !== 'string') bad(`${name} must be a string`);
  const s = v.trim(); if (s.length < min || s.length > max) bad(`${name} must be ${min}..${max} characters`);
  return s;
}
export function int(v, name, min, max, { optional = false } = {}) {
  if (v === undefined || v === null) { if (optional) return undefined; bad(`${name} is required`); }
  if (!Number.isInteger(v) || v < min || v > max) bad(`${name} must be an integer ${min}..${max}`);
  return v;
}
export function num(v, name, min, max, { optional = false } = {}) {
  if (v === undefined || v === null) { if (optional) return undefined; bad(`${name} is required`); }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`${name} must be a number ${min}..${max}`);
  return v;
}
export function bool(v, name, { optional = false } = {}) {
  if (v === undefined || v === null) { if (optional) return undefined; bad(`${name} is required`); }
  if (typeof v !== 'boolean') bad(`${name} must be boolean`);
  return v;
}
export function limitParam(q, def = 100, max = 500) {
  if (q === undefined) return def;
  const n = Number(q); if (!Number.isInteger(n) || n < 1) bad('limit must be a positive integer');
  return Math.min(n, max);
}
export const flag = (v) => v === '1' || v === 'true';
export function msParam(v, name) { if (v === undefined || v === '') return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0) bad(`${name} must be epoch milliseconds`); return n; }
