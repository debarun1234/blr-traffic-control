import { h, icon, toast, initTheme, setTheme, $ } from './vendor/ui.mjs';
import { cfg, api, ApiError, errMsg, onUnauthed } from './lib/api.mjs';
import { initAuth, signIn, signOut } from './lib/auth.mjs';
import { loadMap } from './lib/mapview.mjs';
import { skeleton, errorState } from './lib/kit.mjs';

initTheme();
const app = document.getElementById('app');

/* ---------- environment ribbon ---------- */
const ENV = { production: 'Production: changes here affect live operations', staging: 'Staging: safe to test, not the live system', local: 'Local development' };
function ribbon() {
  const env = cfg.env in ENV ? cfg.env : 'unknown';
  const r = document.getElementById('ribbon'); r.className = env;
  r.replaceChildren(h('span', env === 'unknown' ? 'Environment not set' : env), h('span.rt', env === 'unknown' ? 'config.js has no "env"; ask the deployer to set it.' : ENV[env]));
}

/* ---------- pages ---------- */
export const PAGES = [
  { id: 'overview', title: 'Overview', ico: 'gauge', group: 'Monitor', mod: () => import('./pages/overview.mjs') },
  { id: 'checks', title: 'System checks', ico: 'check', group: 'Monitor', mod: () => import('./pages/checks.mjs') },
  { id: 'audit', title: 'Audit log', ico: 'list', group: 'Monitor', mod: () => import('./pages/audit.mjs') },
  { id: 'users', title: 'Users & roles', ico: 'users', group: 'Access', mod: () => import('./pages/users.mjs') },
  { id: 'apikeys', title: 'API keys', ico: 'key', group: 'Access', mod: () => import('./pages/apikeys.mjs') },
  { id: 'stations', title: 'Stations & territories', ico: 'map', group: 'Data', mod: () => import('./pages/stations.mjs') },
  { id: 'works', title: 'Works & incidents', ico: 'wrench', group: 'Data', mod: () => import('./pages/works.mjs') },
  { id: 'probes', title: 'Traffic probes', ico: 'route', group: 'Data', mod: () => import('./pages/probes.mjs') },
  { id: 'connectors', title: 'Connectors', ico: 'plug', group: 'Integrations', mod: () => import('./pages/connectors.mjs') },
  { id: 'ai', title: 'AI & cost', ico: 'cpu', group: 'Platform', mod: () => import('./pages/ai.mjs') },
  { id: 'settings', title: 'Settings', ico: 'settings', group: 'Platform', mod: () => import('./pages/settings.mjs') },
];

/* ---------- sign-in / denied ---------- */
function brand() { return h('div.brand', h('div.mark', icon('shield', 18)), h('div', 'BLR Traffic Control', h('small', 'Administration'))); }
function signInPage(msg) {
  const dev = cfg.authMode !== 'google';
  const err = h('div.banner.bad' + (msg ? '' : '.hide'), { role: 'alert' }, msg ?? '');
  const email = h('input.input', { id: 'dev-email', type: 'email', autocomplete: 'username', placeholder: 'you@example.com', required: true, 'data-autofocus': '' });
  const go = async (e) => { e?.preventDefault(); try { err.classList.add('hide'); await signIn(email.value); await start(); } catch (x) { err.textContent = x?.code === 'auth/popup-closed-by-user' ? 'Sign-in was cancelled.' : errMsg(x); err.classList.remove('hide'); } };
  app.replaceChildren(h('div.signin', h('div.panel', brand(),
    h('div.stack', h('h1', 'Admin sign-in'), h('p.muted', 'This site is for administrators who manage users, data feeds and system settings. Access is by allowlist; there is no self-registration.')),
    err,
    dev ? h('form.stack', { onsubmit: go }, h('div.banner.info', 'Dev mode: no password. Enter an allowlisted email to impersonate it.'), h('div.field', h('label', { for: 'dev-email' }, 'Email'), email), h('button.btn.primary', { type: 'submit' }, 'Continue'))
      : h('button.btn.primary', { type: 'button', onclick: go }, 'Sign in with Google'),
    h('p.faint.sm', 'Admin console is English only.')),
    h('div.art', h('div', { style: { maxWidth: '360px', color: 'var(--ink-2)' } }, h('h2', { style: { marginBottom: '8px', color: 'var(--ink)' } }, 'Control what the control room sees'), h('p', 'Users, stations, connectors, probes, AI limits and system health in one place. Every change is written to the audit log.')))));
  setTimeout(() => email.focus(), 0);
}
function deniedPage(title, text, me) {
  app.replaceChildren(h('div.denied', h('div.card.stack', brand(), h('h1', title), h('p.muted', text),
    me ? h('dl.kv', h('dt', 'Signed in as'), h('dd.mono', me.email), h('dt', 'Role'), h('dd', me.role ?? 'none')) : null,
    h('div.row', h('a.btn.primary', { href: cfg.controlUrl || '/' }, 'Go to the Control app'), h('button.btn', { onclick: async () => { await signOut(); location.hash = ''; signInPage(); } }, 'Sign out')))));
}

/* ---------- shell ---------- */
let ctx = null, cleanup = null, navTok = 0;
function initials(me) { return (me.name || me.email).split(/[ .@]/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join(''); }
function buildShell() {
  const side = h('nav.sidebar', { 'aria-label': 'Admin sections' });
  let g = null;
  for (const p of PAGES) {
    if (p.group !== g) { g = p.group; side.append(h('h3.nav-sec', g)); }
    side.append(h('a.nav-a', { href: '#/' + p.id, dataset: { page: p.id } }, icon(p.ico), p.title));
  }
  const env = cfg.env in ENV ? cfg.env : null;
  const maint = h('span.badge.warn.hide', { id: 'maint', title: 'Feed is paused (maintenance mode)' }, 'Maintenance on');
  const themeBtn = h('button.btn.ghost.sm', { 'aria-label': 'Toggle light or dark theme', title: 'Toggle theme', onclick: () => { const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; setTheme(dark ? 'light' : 'dark'); } }, icon('sun', 17));
  const top = h('header.topbar', brand(), env ? h('span.env.' + env, env) : null, h('div.grow'), maint,
    h('a.btn.ghost.sm.hide-md', { href: cfg.controlUrl || '/' }, 'Control app'), themeBtn,
    h('div.sess', h('div.avatar', { 'aria-hidden': 'true' }, initials(ctx.me)), h('div.who', h('b', { id: 'who' }, ctx.me.name || ctx.me.email), h('span', ctx.me.name ? `${ctx.me.email} · admin` : 'Administrator')),
      h('button.btn.sm', { id: 'signout', onclick: async () => { await signOut(); location.hash = ''; location.reload(); } }, icon('logout', 15), 'Sign out')));
  const main = h('main.main', { id: 'main', tabindex: '-1' });
  app.replaceChildren(h('div.shell', top, side, main));
  ctx.main = main; ctx.setMaintenance(!!ctx.me.flags?.maintenance);
}

async function route() {
  if (!ctx) return;
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'overview';
  const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
  if (page.id !== id) { location.hash = '#/overview'; return; }
  const tok = ++navTok;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  document.querySelectorAll('.nav-a').forEach((a) => (a.dataset.page === page.id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${page.title} · BLR Admin`;
  const root = h('div.page', { dataset: { page: page.id } }, skeleton(8));
  ctx.main.replaceChildren(root); ctx.main.scrollTop = 0;
  try {
    const mod = await page.mod(); if (tok !== navTok) return;
    root.replaceChildren(); const c = await mod.mount(root, ctx); if (tok !== navTok) { c?.(); return; } cleanup = c ?? null;
    const h1 = root.querySelector('h1'); if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  } catch (e) { if (tok === navTok) { console.error(e); root.replaceChildren(errorState(e, route)); } }
}

async function start() {
  app.replaceChildren(h('div.denied', skeleton(3)));
  let who;
  try { who = await initAuth(); } catch (e) { return deniedPage('Sign-in is not available', errMsg(e)); }
  if (!who) return signInPage();
  let me;
  try { me = await api.get('/me'); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401) { await signOut(); return signInPage('Your session expired. Sign in again.'); }
    if (e instanceof ApiError && e.status === 403) return deniedPage('You are not on the allowlist', 'Sign-in is allowlist-only and this account is not active. Ask an administrator to add it.', { email: who.email });
    return deniedPage('Cannot reach the API', errMsg(e), null);
  }
  if (me.role !== 'admin') return deniedPage('Administrators only', `This site manages users, feeds and settings. Your role (${me.role}) does not have access. The Control app is where you do your day-to-day work.`, me);
  let map; try { map = await loadMap(); } catch (e) { return deniedPage('Map data missing', errMsg(e)); }
  ctx = { me, map, stations: map.st, hubs: map.hubs, signOut,
    setMaintenance(on) { me.flags = { ...(me.flags ?? {}), maintenance: on }; $('#maint')?.classList.toggle('hide', !on); } };
  onUnauthed.fn = async () => { await signOut(); ctx = null; signInPage('Your session expired. Sign in again.'); };
  buildShell(); if (!location.hash) location.hash = '#/overview'; route();
}

ribbon();
addEventListener('hashchange', route);
start();
