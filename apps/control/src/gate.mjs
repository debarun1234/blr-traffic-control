// Pre-app screens: sign-in, not-on-allowlist, maintenance, offline / error.
import { h, setTheme } from '/vendor/ui.mjs';
import { fill } from './util.mjs';
import { t, roleLabel } from './i18n.mjs';
import { ic } from './icons.mjs';
import { DEV_USERS } from './auth.mjs';
import { S, setLang } from './state.mjs';

const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const GOOGLE_G = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('width', 18); s.setAttribute('height', 18); s.setAttribute('aria-hidden', 'true');
  [['#EA4335', 'M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z'], ['#4285F4', 'M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z'], ['#FBBC05', 'M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z'], ['#34A853', 'M24 48c6.5 0 11.900-2.100 15.900-5.800l-7.400-5.700c-2.100 1.400-4.800 2.300-8.500 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z']]
    .forEach(([f, d]) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('fill', f); p.setAttribute('d', d); s.append(p); });
  return s;
};

function utilBar() {
  return h('div.row.cc-util', h('button.btn.sm.ghost', { 'data-testid': 'lang', onclick: () => setLang(S.lang === 'kn' ? 'en' : 'kn') }, ic('globe', 15), S.lang === 'kn' ? 'English' : 'ಕನ್ನಡ'),
    h('button.btn.sm.ghost', { 'data-testid': 'theme', 'aria-label': t('theme.toggle'), onclick: () => { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); } }, ic(effectiveTheme() === 'dark' ? 'sun' : 'moon', 16)));
}
const brand = () => h('div.brand', h('div.mark', ic('map', 18)), h('div', t('app.name'), h('small', t('app.sub'))));

function drawArt(canvas, map) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth || 560, hh = canvas.clientHeight || 420; canvas.width = w * dpr; canvas.height = hh * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of map.city) for (const p of r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const k = Math.min(w / (x1 - x0), hh / (y1 - y0)) * 0.92, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X = (x) => (x - cx) * k + w / 2, Y = (y) => hh / 2 - (y - cy) * k;
  const cs = getComputedStyle(document.documentElement), col = (v) => cs.getPropertyValue(v).trim();
  g.beginPath(); for (const r of map.city) { g.moveTo(X(r[0][0]), Y(r[0][1])); for (const p of r) g.lineTo(X(p[0]), Y(p[1])); g.closePath(); } g.fillStyle = col('--surface'); g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1; g.strokeStyle = col('--line-2'); g.lineWidth = 1.5; g.stroke();
  const cls = [col('--c4'), col('--accent'), col('--road-major')], width = [1.9, 1.2, 0.7]; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const c of [2, 1, 0]) {
    g.beginPath();
    for (const d of map.d) { if (d[0] !== c || d[4] < 0) continue; const f = d[3]; let x = f[0], y = f[1]; g.moveTo(X(x), Y(y)); for (let j = 2; j < f.length; j += 2) { x += f[j]; y += f[j + 1]; g.lineTo(X(x), Y(y)); } }
    g.strokeStyle = c === 0 ? col('--accent') : c === 1 ? col('--ink-3') : col('--line-2'); g.globalAlpha = c === 0 ? 0.95 : c === 1 ? 0.55 : 0.4; g.lineWidth = width[c]; g.stroke();
  }
  g.globalAlpha = 1; g.strokeStyle = col('--accent'); g.lineWidth = 1.2; g.globalAlpha = 0.5; g.setLineDash([4, 4]);
  for (const reg of Object.values(map.reg)) { g.beginPath(); for (const r of reg) { g.moveTo(X(r[0][0]), Y(r[0][1])); for (const p of r) g.lineTo(X(p[0]), Y(p[1])); g.closePath(); } g.stroke(); }
}

export function renderSignin(root, { auth, mapPromise, error }) {
  const cfg = S.cfg, dev = cfg.authMode !== 'google';
  const err = h('div.banner.bad.sm', { role: 'alert', hidden: !error, 'data-testid': 'signin-error' }, error ?? '');
  const go = async (email) => { err.hidden = true; try { await auth.signIn(email); } catch (e) { err.textContent = e?.code === 'auth/popup-closed-by-user' ? t('signin.cancelled') : t('signin.failed'); err.hidden = false; } };
  const art = h('canvas.cc-art', { 'aria-hidden': 'true' });
  let body;
  if (dev) {
    const email = h('input.input', { type: 'email', id: 'dev-email', placeholder: 'name@example.test', 'aria-label': t('signin.otherEmail'), 'data-testid': 'dev-email' });
    body = h('div.stack', h('div.banner.info.sm', ic('alert', 16), t('signin.devNote')),
      h('div.cc-devlist', { role: 'group', 'aria-label': t('signin.devPick') }, DEV_USERS.map((u) => h('button.cc-devuser', { 'data-testid': `dev-${u.email.split('@')[0]}`, onclick: () => go(u.email) }, h('span.cc-du-e', u.email), h('span.badge', roleLabel(u.role)), h('span.xs.faint', t(`signin.scope.${u.role}`))))),
      h('form.row.nowrap', { onsubmit: (e) => { e.preventDefault(); if (email.value.trim()) go(email.value); } }, email, h('button.btn', { type: 'submit' }, t('signin.go'))));
  } else {
    body = h('button.cc-gbtn', { 'data-testid': 'google-signin', onclick: () => go() }, GOOGLE_G(), t('signin.google'));
  }
  fill(root, h('div.signin.cc-signin',
    h('div.panel', h('div.row.between.nowrap', brand(), utilBar()), h('div.stack', h('h1', t('signin.title')), h('p.muted', t('signin.purpose'))), err, body,
      h('p.sm.muted.cc-honest', ic('shield', 15), t('signin.honest'))),
    h('div.art', h('div.cc-artcard', art, h('div.cc-artcap', h('b', t('signin.art.t')), h('span.xs.faint', t('signin.art.s')))))));
  mapPromise.then((m) => { drawArt(art, m); }).catch(() => {});
  new MutationObserver(() => mapPromise.then((m) => drawArt(art, m)).catch(() => {})).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function renderGate(root, kind, { email, onSignOut, onRetry, detail }) {
  const spec = {
    denied: { icon: 'shield', title: t('gate.denied.t'), text: t('gate.denied.d'), tone: 'warn' },
    unauth: { icon: 'key', title: t('gate.unauth.t'), text: t('gate.unauth.d'), tone: 'warn' },
    maintenance: { icon: 'wrench', title: t('gate.maint.t'), text: t('gate.maint.d'), tone: 'info' },
    offline: { icon: 'wifiOff', title: t('gate.offline.t'), text: t('gate.offline.d'), tone: 'bad' },
    error: { icon: 'alert', title: t('gate.error.t'), text: t('gate.error.d'), tone: 'bad' },
  }[kind];
  fill(root, h('div.cc-gatewrap', h('div.card.cc-gate', { role: 'alert', 'data-testid': `gate-${kind}` },
    h('div.cc-gate-i.' + spec.tone, ic(spec.icon, 26)), h('h1', spec.title), h('p.muted', spec.text),
    email ? h('div.cc-gate-email', { 'data-testid': 'gate-email' }, email) : null, detail ? h('p.xs.faint', detail) : null,
    h('div.row', { style: { justifyContent: 'center', marginTop: '8px' } }, onRetry ? h('button.btn.primary', { onclick: onRetry, 'data-testid': 'gate-retry' }, t('retry')) : null,
      onSignOut ? h('button.btn', { onclick: onSignOut, 'data-testid': 'gate-signout' }, ic('logout', 15), t('menu.signout')) : null), utilBar())));
}
