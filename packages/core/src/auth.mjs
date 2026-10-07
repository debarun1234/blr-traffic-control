import { err } from './errors.mjs';
import { normaliseEmail, validateUser } from '@blr/shared';

const CACHE_MS = 60000, LOGIN_TOUCH_MS = 10 * 60000;

/** Throws if AUTH_MODE=dev in production. Call at process start. */
export function assertAuthConfig(env = process.env) {
  if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') throw new Error('AUTH_MODE=dev is forbidden when NODE_ENV=production');
}
export const bootstrapAdmins = (env = process.env) => new Set(String(env.BOOTSTRAP_ADMIN_EMAILS ?? '').split(',').map(normaliseEmail).filter(Boolean));

/** Firebase ID-token verifier (firebase-admin imported lazily). Returns async (token) => claims. */
export function createFirebaseVerifier({ projectId } = {}) {
  let auth;
  return async (token) => {
    if (!auth) {
      const { initializeApp, getApps } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const app = getApps()[0] ?? initializeApp(projectId ? { projectId } : undefined);
      auth = getAuth(app);
    }
    return auth.verifyIdToken(token);
  };
}

/**
 * @param {{store:any, clock:{now():number}, env?:object, verifier?:(t:string)=>Promise<{email?:string,uid?:string,name?:string,email_verified?:boolean}>}} o
 */
export function createAuthenticator({ store, clock, env = process.env, verifier }) {
  assertAuthConfig(env);
  const boot = bootstrapAdmins(env);
  const cache = new Map(); // email -> {at, user}
  const devMode = env.AUTH_MODE === 'dev';

  async function load(email, claims) {
    const hit = cache.get(email);
    if (hit && clock.now() - hit.at < CACHE_MS) return hit.user;
    let doc = await store.get('users', email);
    if (!doc && boot.has(email)) {
      doc = { email, name: claims?.name ?? '', role: 'admin', active: true, createdBy: 'bootstrap', createdAt: clock.now() };
      await store.set('users', email, doc);
    }
    if (doc && claims?.uid && (doc.uid !== claims.uid || !doc.lastLogin || clock.now() - doc.lastLogin > LOGIN_TOUCH_MS)) {
      doc = await store.update('users', email, { uid: claims.uid, lastLogin: clock.now() });
    }
    cache.set(email, { at: clock.now(), user: doc });
    return doc;
  }
  return {
    invalidate(email) { if (email) cache.delete(normaliseEmail(email)); else cache.clear(); },
    /** @returns {Promise<object>} the active user doc, or throws unauthenticated(401)/forbidden(403). */
    async verifyRequest(headers) {
      let email, claims;
      const dev = headers['x-dev-user'];
      if (devMode && dev) email = normaliseEmail(Array.isArray(dev) ? dev[0] : dev);
      else {
        const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
        if (!m || !verifier) throw err('unauthenticated', 'Missing credentials');
        try { claims = await verifier(m[1]); } catch { throw err('unauthenticated', 'Invalid token'); }
        if (!claims?.email || claims.email_verified === false) throw err('unauthenticated', 'Unverified email');
        email = normaliseEmail(claims.email);
      }
      if (!email) throw err('unauthenticated', 'Missing credentials');
      const user = await load(email, claims);
      if (!user || user.active === false) throw err('forbidden', 'Account is not on the allowlist');
      return user;
    },
    validateUser,
  };
}
