/** Test helpers: a tiny in-memory fake of the Firestore calls used by createFirestoreStore. */
export { fixedClock } from './clock.mjs';
export { createMemoryStore } from './store.mjs';
export function createFakeFirestore() {
  const data = new Map(); // "col/id" -> object (stored as given, including Date)
  const snap = (id, d) => ({ id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)) });
  const ref = (c, id) => ({ id, get: async () => snap(id, data.get(`${c}/${id}`)), set: async (v) => { data.set(`${c}/${id}`, structuredClone(v)); }, delete: async () => { data.delete(`${c}/${id}`); }, _k: `${c}/${id}` });
  const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const val = (x) => (x instanceof Date ? +x : x);
  const query = (c, wh = [], ord = null, lim = 0) => ({
    where: (f, op, v) => query(c, [...wh, [f, op, v]], ord, lim), orderBy: (f, d) => query(c, wh, [f, d], lim), limit: (n) => query(c, wh, ord, n),
    get: async () => {
      let rows = [...data.entries()].filter(([k]) => k.startsWith(c + '/')).map(([k, d]) => [k.slice(c.length + 1), d]);
      for (const [f, op, v] of wh) rows = rows.filter(([, d]) => { const x = val(dig(d, f)), y = val(v); return x !== undefined && ({ '==': x === y, '!=': x !== y, '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y, in: Array.isArray(y) && y.includes(x), 'array-contains': Array.isArray(dig(d, f)) && dig(d, f).includes(y) })[op]; });
      if (ord) { rows = rows.filter(([, d]) => dig(d, ord[0]) !== undefined); rows.sort((a, b) => (ord[1] === 'desc' ? -1 : 1) * (val(dig(a[1], ord[0])) < val(dig(b[1], ord[0])) ? -1 : val(dig(a[1], ord[0])) > val(dig(b[1], ord[0])) ? 1 : 0)); }
      if (lim) rows = rows.slice(0, lim);
      return { docs: rows.map(([id, d]) => snap(id, d)) };
    },
  });
  let n = 0;
  const db = {
    _data: data,
    collection: (c) => ({ doc: (id) => ref(c, id ?? `auto${++n}`), ...query(c) }),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = { get: (r) => r.get(), set: (r, v) => writes.push(() => r.set(v)), delete: (r) => writes.push(() => r.delete()) };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
  return db;
}
