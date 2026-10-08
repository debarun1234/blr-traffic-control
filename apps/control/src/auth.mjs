// Authentication: Firebase (Google popup) in production, x-dev-user picker locally.
import { lsGet, lsSet, lsDel } from './util.mjs';

export const DEV_USERS = [
  { email: 'admin@example.test', role: 'admin' },
  { email: 'commissioner@example.test', role: 'commissioner' },
  { email: 'north.dcp@example.test', role: 'dcp' },
  { email: 'yalahanka@example.test', role: 'station' },
  { email: 'indiranagar@example.test', role: 'station' },
  { email: 'viewer@example.test', role: 'viewer' },
];
const FB_VERSION = '11.0.2';
const FB = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

export async function initAuth(cfg) {
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(api.user));
  const api = {
    mode: cfg.authMode, user: null,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
  if (cfg.authMode === 'google') {
    if (!cfg.firebase) throw new Error('config: firebase settings missing');
    const [{ initializeApp }, A] = await Promise.all([import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`)]);
    const auth = A.getAuth(initializeApp(cfg.firebase));
    await new Promise((res) => { const un = A.onAuthStateChanged(auth, (u) => { api.user = u ? { email: (u.email ?? '').toLowerCase(), name: u.displayName ?? '' } : null; un(); res(); }); });
    A.onAuthStateChanged(auth, (u) => { api.user = u ? { email: (u.email ?? '').toLowerCase(), name: u.displayName ?? '' } : null; emit(); });
    api.signIn = async () => { const provider = new A.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' }); const r = await A.signInWithPopup(auth, provider); api.user = { email: (r.user.email ?? '').toLowerCase(), name: r.user.displayName ?? '' }; emit(); };
    api.signOut = async () => { await A.signOut(auth); api.user = null; emit(); };
    api.headers = async () => (auth.currentUser ? { authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {});
    api.refresh = async () => { if (auth.currentUser) await auth.currentUser.getIdToken(true); };
  } else {
    const saved = lsGet('blr-dev-user');
    api.user = saved ? { email: saved, name: '' } : null;
    api.signIn = async (email) => { const e = String(email ?? '').trim().toLowerCase(); if (!e) return; lsSet('blr-dev-user', e); api.user = { email: e, name: '' }; emit(); };
    api.signOut = async () => { lsDel('blr-dev-user'); api.user = null; emit(); };
    api.headers = async () => (api.user ? { 'x-dev-user': api.user.email } : {});
    api.refresh = async () => {};
  }
  return api;
}
