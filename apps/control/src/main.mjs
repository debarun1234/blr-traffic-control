// Entry point: config -> auth gate -> /api/me -> map + shell -> polling.
import { h } from '/vendor/ui.mjs';
import { fill } from './util.mjs';
import { S, on, setLang, lockedRegion } from './state.mjs';
import { createApi } from './api.mjs';
import { initAuth } from './auth.mjs';
import { buildMapData } from './map/data.mjs';
import { startSim } from './sim.mjs';
import { loadMe, startPolling, stopPolling, resetFeed, pollNow } from './feed.mjs';
import { renderSignin, renderGate } from './gate.mjs';
import { mountApp, installShortcuts } from './shell.mjs';
import { t } from './i18n.mjs';

const root = document.getElementById('root');
const cfg = { authMode: 'dev', apiBase: '/api', adminUrl: '/admin/', pollMs: 30000, ...(window.__CONFIG__ ?? {}) };
S.cfg = cfg;
setLang(S.lang);
const mapPromise = fetch('/assets/map.json').then((r) => { if (!r.ok) throw new Error('map ' + r.status); return r.json(); });
mapPromise.catch(() => {});

let auth, app = null, screen = null, token = 0, retryTimer = null;
const show = (fn) => { screen = fn; fn(); };

async function signOut() {
  token++; clearTimeout(retryTimer); stopPolling(); unmount(); resetFeed(); S.me = null; S.sel = null; S.replay = null; S.tab = 'overview';
  try { await auth.signOut(); } catch { /* ignore */ }
  route();
}
function unmount() { if (app) { app.destroy(); app = null; } }

function gate(kind, extra = {}) {
  unmount(); stopPolling(); clearTimeout(retryTimer);
  show(() => renderGate(root, kind, { email: auth.user?.email, onSignOut: signOut, ...extra }));
}

async function startSession() {
  const my = ++token; clearTimeout(retryTimer);
  fill(root, h('div.cc-boot', { role: 'status', 'aria-label': t('loading') }, h('div.stack', { style: { width: '220px' } }, h('div.skel', { style: { height: '14px' } }), h('div.skel', { style: { height: '14px', width: '70%' } }))));
  try {
    const [me, map] = await Promise.all([loadMe(), mapPromise]);
    if (my !== token) return;
    if (!S.MD) { S.MD = buildMapData(map); startSim(S.MD.net); }
    if (me.flags.maintenance && me.role !== 'admin') {
      gate('maintenance', { onRetry: () => startSession() });
      retryTimer = setTimeout(() => { if (my === token) startSession(); }, 15000); return;
    }
    S.scope = lockedRegion() ?? 'All'; S.gate = null;
    mount(); startPolling();
  } catch (e) {
    if (my !== token) return;
    if (e.status === 403) return gate('denied', { onRetry: () => startSession() });
    if (e.status === 401) return gate('unauth', { onRetry: () => { auth.refresh?.().finally(startSession); } });
    if (e.status === 503 && /maintenance/i.test(e.message)) { gate('maintenance', { onRetry: () => startSession() }); retryTimer = setTimeout(() => { if (my === token) startSession(); }, 15000); return; }
    const net = e.status === 0 || e.network || e.status >= 500 || /map/.test(e.message);
    gate(net ? 'offline' : 'error', { onRetry: () => startSession(), detail: e.message });
    if (net) retryTimer = setTimeout(() => { if (my === token) startSession(); }, 8000);
  }
}
function mount() { unmount(); app = mountApp(root, { onSignOut: signOut }); screen = null; }

function route() {
  if (!auth.user) { unmount(); stopPolling(); show(() => renderSignin(root, { auth, mapPromise })); }
  else startSession();
}

on('gate', () => { if (S.gate) gate(S.gate.kind, { onRetry: S.gate.kind === 'unauth' ? undefined : () => startSession() }); });
on('lang', () => {
  if (app) { const v = { ...app.map.view }; unmount(); S.viewKeep = v; mount(); }
  else if (screen) screen();
});

(async function boot() {
  try { auth = await initAuth(cfg); }
  catch (e) { fill(root); renderGate(root, 'error', { detail: String(e.message ?? e), onRetry: () => location.reload() }); return; }
  S.auth = auth; S.api = createApi({ base: cfg.apiBase, headers: () => auth.headers() });
  installShortcuts();
  auth.onChange(() => route());
  window.__blr = { S, pollNow };
  route();
})();
