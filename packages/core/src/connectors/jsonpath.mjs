const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const cache = new Map();
function tokens(path) {
  if (cache.has(path)) return cache.get(path);
  if (typeof path !== 'string' || path[0] !== '$') throw new Error(`path must start with $: ${path}`);
  const out = []; const re = /\.([A-Za-z0-9_\-]+)|\[(\d+)\]|\[\*\]|\.\*|\['([^']+)'\]/g; let i = 1, m;
  while (i < path.length) {
    re.lastIndex = i; m = re.exec(path);
    if (!m || m.index !== i) throw new Error(`bad path at ${i}: ${path}`);
    if (m[1] !== undefined) out.push({ k: m[1] }); else if (m[2] !== undefined) out.push({ n: Number(m[2]) }); else if (m[3] !== undefined) out.push({ k: m[3] }); else out.push({ all: true });
    i = re.lastIndex;
  }
  for (const t of out) if (t.k !== undefined && BAD.has(t.k)) throw new Error('forbidden key in path');
  cache.set(path, out); return out;
}
/** JSONPath-lite: $ .key ['key'] [n] [*] .* . Returns all matches. */
export function query(obj, path) {
  let cur = [obj];
  for (const t of tokens(path)) {
    const next = [];
    for (const c of cur) {
      if (c === null || typeof c !== 'object') continue;
      if (t.all) next.push(...(Array.isArray(c) ? c : Object.values(c)));
      else if (t.n !== undefined) { if (Array.isArray(c) && c.length > t.n) next.push(c[t.n]); }
      else if (Object.hasOwn(c, t.k)) next.push(c[t.k]);
    }
    cur = next;
  }
  return cur;
}
export const first = (obj, path) => query(obj, path)[0];
export function validPath(path) { try { tokens(path); return true; } catch { return false; } }
/** Items at `path`: a single array match is unwrapped; wildcards flatten. */
export function items(obj, path = '$') { const m = query(obj, path); return m.length === 1 && Array.isArray(m[0]) ? m[0] : m; }
/** Resolve a mapping value: string path, or {const: v}. */
export const pick = (obj, spec) => (spec && typeof spec === 'object' && 'const' in spec ? spec.const : typeof spec === 'string' ? first(obj, spec) : undefined);
