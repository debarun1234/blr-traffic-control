/**
 * Store abstraction. Both implementations behave identically (see test/store.conformance.mjs).
 *
 * interface Store {
 *   get(col,id) -> doc|null
 *   set(col,id,data) -> replace
 *   update(col,id,patchOrFn) -> doc   patch: shallow top-level merge, throws not_found if missing.
 *                                     fn(current|null) -> next|undefined (undefined = leave unchanged). Atomic. Also usable as create-if-absent.
 *   delete(col,id)
 *   list(col,{where:[[field,op,value]],orderBy:'f'|['f','asc'|'desc'],limit}) -> doc[]
 *   add(col,data) -> doc (with generated `id` unless data.id present)
 *   batch([{op:'set'|'update'|'delete',col,id,data}])  atomic, <=500 ops
 * }
 * ops: == != < <= > >= in array-contains. `undefined` values are dropped. Field `expireAt` (epoch ms) is the TTL field.
 */
import { randomBytes } from 'node:crypto';
import { err } from './errors.mjs';
import { isObj } from './util.mjs';

export const OPS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains'];
const clean = (v) => {
  if (Array.isArray(v)) return v.map((x) => clean(x) ?? null);
  if (isObj(v)) { const o = {}; for (const [k, x] of Object.entries(v)) { const c = clean(x); if (c !== undefined) o[k] = c; } return o; }
  if (typeof v === 'function' || typeof v === 'symbol') return undefined;
  return v;
};
const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const normOrder = (o) => (!o ? null : typeof o === 'string' ? [o, 'asc'] : Array.isArray(o) ? [o[0], o[1] ?? 'asc'] : [o.field, o.dir ?? 'asc']);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function match(doc, [f, op, val]) {
  const v = dig(doc, f);
  switch (op) {
    case '==': return v === val;
    case '!=': return v !== undefined && v !== val; // Firestore: field must exist
    case '<': return v !== undefined && v < val;
    case '<=': return v !== undefined && v <= val;
    case '>': return v !== undefined && v > val;
    case '>=': return v !== undefined && v >= val;
    case 'in': return Array.isArray(val) && val.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(val);
    default: throw err('invalid', `bad operator ${op}`);
  }
}
const newId = () => randomBytes(10).toString('base64url');

export function createMemoryStore() {
  /** @type {Map<string,Map<string,object>>} */
  const cols = new Map();
  const col = (c) => { let m = cols.get(c); if (!m) cols.set(c, (m = new Map())); return m; };
  const copy = (d) => (d == null ? null : structuredClone(d));
  const put = (c, id, data) => { col(c).set(id, structuredClone(clean(data))); };
  const merge = (c, id, patch) => {
    const cur = col(c).get(id); if (!cur) throw err('not_found', `${c}/${id}`);
    const next = { ...cur }; for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
    put(c, id, next); return copy(col(c).get(id));
  };
  const store = {
    kind: 'memory',
    async get(c, id) { return copy(col(c).get(id)); },
    async set(c, id, data) { put(c, id, data); },
    async update(c, id, patchOrFn) {
      if (typeof patchOrFn !== 'function') return merge(c, id, patchOrFn);
      const next = patchOrFn(copy(col(c).get(id)));
      if (next === undefined) return copy(col(c).get(id));
      put(c, id, next); return copy(col(c).get(id));
    },
    async delete(c, id) { col(c).delete(id); },
    async list(c, { where = [], orderBy, limit } = {}) {
      let rows = [...col(c).entries()].map(([id, d]) => [id, d]).filter(([, d]) => where.every((w) => match(d, w)));
      const o = normOrder(orderBy);
      if (o) rows = rows.filter(([, d]) => dig(d, o[0]) !== undefined).sort((x, y) => (o[1] === 'desc' ? -1 : 1) * cmp(dig(x[1], o[0]), dig(y[1], o[0])) || cmp(x[0], y[0]));
      else rows.sort((x, y) => cmp(x[0], y[0]));
      if (limit) rows = rows.slice(0, limit);
      return rows.map(([, d]) => copy(d));
    },
    async add(c, data) { const id = data?.id ?? newId(); const d = { ...data, id }; put(c, id, d); return copy(col(c).get(id)); },
    async batch(ops) {
      if (ops.length > 500) throw err('invalid', 'batch too large');
      const snapshot = new Map([...cols].map(([k, v]) => [k, new Map(v)]));
      try {
        for (const o of ops) {
          if (o.op === 'set') put(o.col, o.id, o.data);
          else if (o.op === 'update') merge(o.col, o.id, o.data);
          else if (o.op === 'delete') col(o.col).delete(o.id);
          else throw err('invalid', `bad op ${o.op}`);
        }
      } catch (e) { cols.clear(); for (const [k, v] of snapshot) cols.set(k, v); throw e; }
    },
  };
  return store;
}

/**
 * Firestore store. `db` is a @google-cloud/firestore Firestore instance (or a fake with the same few calls):
 *   db.collection(c).doc(id?) -> ref{get,set,delete,id}; db.collection(c).where().orderBy().limit().get() -> {docs:[{id,data()}]}
 *   db.runTransaction(fn(tx)) with tx.get(ref)/set/delete.
 * `expireAt` is stored as a Firestore Timestamp (Date) so a TTL policy can act on it, and read back as epoch ms.
 */
export function createFirestoreStore(db) {
  const toDb = (v, top = true) => {
    if (Array.isArray(v)) return v.map((x) => toDb(x, false) ?? null);
    if (isObj(v)) { const o = {}; for (const [k, x] of Object.entries(v)) { const c = toDb(x, false); if (c !== undefined) o[k] = c; } if (top && typeof o.expireAt === 'number') o.expireAt = new Date(o.expireAt); return o; }
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    return v;
  };
  const fromDb = (d) => {
    if (d == null) return null;
    const o = { ...d };
    if (o.expireAt != null && typeof o.expireAt !== 'number') o.expireAt = typeof o.expireAt.toMillis === 'function' ? o.expireAt.toMillis() : +o.expireAt;
    return o;
  };
  const ref = (c, id) => db.collection(c).doc(id);
  const mergeInto = (cur, patch) => { const n = { ...cur }; for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete n[k]; else n[k] = v; } return n; };
  const toWhere = ([f, op, v]) => [f, op, op !== '==' && op !== 'in' && op !== 'array-contains' && f === 'expireAt' && typeof v === 'number' ? new Date(v) : v];
  return {
    kind: 'firestore',
    async get(c, id) { const s = await ref(c, id).get(); return s.exists ? fromDb(s.data()) : null; },
    async set(c, id, data) { await ref(c, id).set(toDb(data)); },
    async update(c, id, patchOrFn) {
      return db.runTransaction(async (tx) => {
        const s = await tx.get(ref(c, id)); const cur = s.exists ? fromDb(s.data()) : null;
        if (typeof patchOrFn !== 'function') {
          if (!cur) throw err('not_found', `${c}/${id}`);
          const n = mergeInto(cur, patchOrFn); tx.set(ref(c, id), toDb(n)); return n;
        }
        const next = patchOrFn(cur);
        if (next === undefined) return cur;
        tx.set(ref(c, id), toDb(next)); return fromDb(toDb(next));
      });
    },
    async delete(c, id) { await ref(c, id).delete(); },
    async list(c, { where = [], orderBy, limit } = {}) {
      let q = db.collection(c);
      for (const w of where) { const [f, op, v] = toWhere(w); if (!OPS.includes(op)) throw err('invalid', `bad operator ${op}`); q = q.where(f, op, v); }
      const o = normOrder(orderBy); if (o) q = q.orderBy(o[0], o[1]);
      if (limit) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => fromDb(d.data()));
    },
    async add(c, data) { const r = db.collection(c).doc(); const d = { ...data, id: data?.id ?? r.id }; await (data?.id ? ref(c, data.id) : r).set(toDb(d)); return fromDb(toDb(d)); },
    async batch(ops) {
      if (ops.length > 500) throw err('invalid', 'batch too large');
      await db.runTransaction(async (tx) => {
        const cur = new Map();
        for (const o of ops) if (o.op === 'update' && !cur.has(`${o.col}/${o.id}`)) { const s = await tx.get(ref(o.col, o.id)); cur.set(`${o.col}/${o.id}`, s.exists ? fromDb(s.data()) : null); }
        for (const o of ops) {
          if (o.op === 'set') tx.set(ref(o.col, o.id), toDb(o.data));
          else if (o.op === 'delete') tx.delete(ref(o.col, o.id));
          else if (o.op === 'update') {
            const k = `${o.col}/${o.id}`, c0 = cur.get(k); if (!c0) throw err('not_found', k);
            const n = mergeInto(c0, o.data); cur.set(k, n); tx.set(ref(o.col, o.id), toDb(n));
          } else throw err('invalid', `bad op ${o.op}`);
        }
      });
    },
  };
}
/** Real Firestore factory (lazy import so tests and dev need no GCP libs). */
export async function createFirestoreStoreFromEnv(env = process.env) {
  const { Firestore } = await import('@google-cloud/firestore');
  return createFirestoreStore(new Firestore({ projectId: env.GOOGLE_CLOUD_PROJECT || undefined, databaseId: env.FIRESTORE_DATABASE || undefined, ignoreUndefinedProperties: true }));
}
