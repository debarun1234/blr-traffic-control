/** Auth: Firebase (Google) in 'google' mode, x-dev-user picker in 'dev' mode. */
import { cfg, setAuthProvider } from './api.mjs';
const FB = 'https://www.gstatic.com/firebasejs/11.10.0';
const DEV_KEY = 'blr-admin-dev-user';
let fb = null; // {auth, mod}
let devUser = null;
const safe = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} } };

export async function initAuth() {
  if (cfg.authMode === 'google') {
    if (!cfg.firebase) throw new Error('Google sign-in is enabled but config.js has no firebase settings.');
    const [{ initializeApp }, mod] = await Promise.all([import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`)]);
    const auth = mod.getAuth(initializeApp(cfg.firebase));
    fb = { auth, mod };
    await auth.authStateReady();
    setAuthProvider(async () => (auth.currentUser ? { authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}));
    return auth.currentUser ? { email: auth.currentUser.email } : null;
  }
  devUser = safe.get(DEV_KEY);
  setAuthProvider(async () => (devUser ? { 'x-dev-user': devUser } : {}));
  return devUser ? { email: devUser } : null;
}
export async function signIn(email) {
  if (cfg.authMode === 'google') {
    const { auth, mod } = fb; const provider = new mod.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
    const r = await mod.signInWithPopup(auth, provider); return { email: r.user.email };
  }
  devUser = String(email).trim().toLowerCase(); safe.set(DEV_KEY, devUser); return { email: devUser };
}
export async function signOut() {
  if (cfg.authMode === 'google' && fb) await fb.mod.signOut(fb.auth);
  devUser = null; safe.set(DEV_KEY, null);
}
