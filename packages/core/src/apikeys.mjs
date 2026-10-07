import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256, rid } from './util.mjs';
import { err } from './errors.mjs';
export const KEY_SCOPES = ['events', 'speeds', 'works'];

export function generateKey() {
  const key = 'blr_' + randomBytes(32).toString('base64url');
  return { key, hash: sha256(key), prefix: key.slice(0, 12) };
}
export async function createApiKey(store, { name, scopes, rateLimit = 60, createdBy, now }) {
  const { key, hash, prefix } = generateKey();
  const doc = { id: rid(6), name, hash, prefix, scopes, rateLimit, createdBy, createdAt: now, revoked: false };
  await store.set('apikeys', doc.id, doc);
  return { doc, key };
}
export const publicKey = ({ hash, ...rest }) => rest;

/** Find the key doc for a presented key. Constant-time compares the stored hash. Returns doc or null. */
export async function lookupKey(store, presented) {
  if (typeof presented !== 'string' || !/^blr_[A-Za-z0-9_-]{43}$/.test(presented)) return null;
  const h = sha256(presented);
  const [doc] = await store.list('apikeys', { where: [['hash', '==', h]], limit: 1 });
  if (!doc || doc.revoked) return null;
  const a = Buffer.from(doc.hash, 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? doc : null;
}
/** Authenticate an ingest request: returns key doc; throws 401/403/429. */
export async function authIngest({ store, limiter, clock }, headers, scope) {
  const doc = await lookupKey(store, headers['x-api-key']);
  if (!doc) throw err('unauthenticated', 'Invalid API key');
  if (!doc.scopes.includes(scope)) throw err('forbidden', `Key lacks scope "${scope}"`);
  const r = limiter.hit(`key:${doc.id}`, doc.rateLimit ?? 60);
  if (!r.ok) throw err('rate_limited', 'API key rate limit exceeded', { retryAfterSec: r.retryAfterSec });
  if (!doc.lastUsed || clock.now() - doc.lastUsed > 60000) store.update('apikeys', doc.id, { lastUsed: clock.now() }).catch(() => {});
  return doc;
}
