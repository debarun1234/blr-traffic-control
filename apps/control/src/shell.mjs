// Application shell: top bar, scope control, map pane + inspector with tabs, banners, menus, shortcuts.
import { h, fmtH, setTheme, toast } from '/vendor/ui.mjs';
import { istParts } from '/vendor/shared.mjs';
import { S, on, emit, collectSubs, setScope, setTab, setLang, setReplay, setSel, can, lockedRegion, isAdmin, curHour, openActions } from './state.mjs';
import { pollNow, aiAvailable } from './feed.mjs';
import { createMapPane } from './map/index.mjs';
import { createOverview } from './panels/overview.mjs';
import { createStation } from './panels/station.mjs';
import { createActions } from './panels/actions.mjs';
import { createPlanner } from './panels/planner.mjs';
import { createWorksPanel } from './panels/works.mjs';
import { t, regionName, roleLabel, agoText } from './i18n.mjs';
import { ic } from './icons.mjs';
import { openDialog } from './dialog.mjs';
import { frame, fill } from './util.mjs';
import { REGIONS } from './analytics.mjs';

const TABS = ['overview', 'station', 'actions', 'planner', 'works'];
const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function statusPill() {
  const L = S.live;
  if (S.replay != null) return { kind: 'warn', text: t('pill.replay'), title: t('pill.replayHint'), live: false };
  if (!L) return S.conn.ok ? { kind: 'info', text: t('pill.connecting'), live: true } : { kind: 'bad', text: t('pill.offline'), title: t('banner.offline') };
  const since = fmtH(istParts(L.updatedAt).h);
  if (!S.conn.ok || L.stale) return { kind: 'bad', text: t('pill.stale', { time: since }), title: !S.conn.ok ? t('banner.offlineNoData') : t('banner.stale', { time: since }), live: false };
  if (L.mode === 'live') return { kind: 'good', text: t('pill.live'), title: t('mode.live.long'), live: true };
  if (L.mode === 'blend') return { kind: 'good', text: t('pill.blend'), title: t('mode.blend.long'), live: true };
  return { kind: 'info', text: t('pill.sim'), title: t('mode.sim.long'), live: true };
}

export function mountApp(root, { onSignOut }) {
  const MD = S.MD;
  let map, panels, tabEls = {}, panelEls = {}, destroyed = false;
  const disposeSubs = collectSubs(() => {
    map = createMapPane(); S.mapRef = map;
    panels = { overview: createOverview(map), station: createStation(map), actions: createActions(), planner: createPlanner(map), works: createWorksPanel() };

    // ---- top bar ----
    const scopeBox = h('div.cc-scope', { role: 'group', 'aria-label': t('scope.aria'), 'data-testid': 'scope' });
    const pill = h('span.badge.cc-pill', { 'data-testid': 'status-pill', role: 'status' });
    const updated = h('span.xs.faint.cc-updated');
    let refreshing = false;
    const refreshBtn = h('button.btn.sm.cc-quick', { 'data-testid': 'refresh', 'aria-label': t('top.refresh.aria'), hidden: true, onclick: async () => {
      if (refreshing) return; refreshing = true; refreshBtn.disabled = true; fill(refreshBtn, ic('rotate', 14), t('top.refresh.busy'));
      try { await S.api.post('/refresh'); await pollNow(); toast(t('top.refresh.done'), 'good'); }
      catch (e) { toast(e?.code === 'rate_limited' ? t('top.refresh.wait', { s: e.extra?.retryAfterSec ?? 60 }) : t('top.refresh.fail'), e?.code === 'rate_limited' ? 'warn' : 'bad'); }
      finally { refreshing = false; refreshBtn.disabled = false; fill(refreshBtn, ic('rotate', 14), t('top.refresh')); }
    } });
    fill(refreshBtn, ic('rotate', 14), t('top.refresh'));
    const clock = h('span.mono.cc-clock', { 'aria-label': t('clock.aria') });
    const roleB = h('span.badge.cc-role', { 'data-testid': 'role-badge' });
    const aiB = h('span.badge.cc-aiq', { 'data-testid': 'ai-quota', hidden: true });
    const langBtn = h('button.btn.sm.cc-quick', { 'data-testid': 'lang', onclick: () => setLang(S.lang === 'kn' ? 'en' : 'kn') }, S.lang === 'kn' ? 'English' : 'ಕನ್ನಡ');
    const themeBtn = h('button.btn.sm.ghost.cc-quick', { 'data-testid': 'theme', 'aria-label': t('theme.toggle'), title: t('theme.toggle'), onclick: toggleTheme }, ic(effectiveTheme() === 'dark' ? 'sun' : 'moon', 17));
    const helpBtn = h('button.btn.sm.ghost.cc-quick', { 'data-testid': 'help', 'aria-label': t('kbd.title'), title: t('kbd.title') + ' (?)', onclick: showShortcuts }, ic('help', 17));
    const menuPop = h('div.cc-menu', { hidden: true, role: 'menu', 'data-testid': 'user-menu' });
    const initials = (S.auth?.user?.email ?? '?').slice(0, 1).toUpperCase();
    const menuBtn = h('button.cc-avatar', { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('menu.account'), 'data-testid': 'menu-btn', onclick: () => toggleMenu() }, initials);
    function toggleMenu(force) {
      const open = force ?? menuPop.hidden; menuPop.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open));
      if (open) { buildMenu(); menuPop.querySelector('button,a')?.focus(); }
    }
    const menuItem = (icon, label, fn, extra = {}) => h('button.cc-mi', { role: 'menuitem', onclick: () => { toggleMenu(false); fn(); }, ...extra }, ic(icon, 16), h('span', label));
    function buildMenu() {
      const adminUrl = S.cfg.adminUrl ?? '/admin/';
      fill(menuPop, h('div.cc-mi-h', h('div.sm', { style: { fontWeight: 600 }, 'data-testid': 'menu-email' }, S.auth?.user?.email ?? S.me?.email), h('div.xs.faint', roleText())),
        menuItem('globe', S.lang === 'kn' ? 'English' : 'ಕನ್ನಡ', () => setLang(S.lang === 'kn' ? 'en' : 'kn')),
        menuItem(effectiveTheme() === 'dark' ? 'sun' : 'moon', t('theme.toggle'), toggleTheme),
        menuItem('help', t('kbd.title'), showShortcuts),
        isAdmin() ? h('a.cc-mi', { role: 'menuitem', href: adminUrl, target: '_blank', rel: 'noopener', 'data-testid': 'admin-link' }, ic('ext', 16), h('span', t('menu.admin'))) : null,
        h('div.cc-mi-sep'), menuItem('logout', t('menu.signout'), onSignOut, { 'data-testid': 'signout' }));
    }
    document.addEventListener('pointerdown', menuOutside); function menuOutside(e) { if (!menuPop.hidden && !menuPop.contains(e.target) && !menuBtn.contains(e.target)) toggleMenu(false); }
    menuPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleMenu(false); menuBtn.focus(); } });
    root._cleanup = () => document.removeEventListener('pointerdown', menuOutside);

    const top = h('header.topbar.cc-top', h('div.brand', h('div.mark', ic('map', 18)), h('div.cc-brandtxt', t('app.name'), h('small', t('app.sub')))), scopeBox,
      h('div.grow'), h('div.cc-status', pill, updated), refreshBtn, clock, roleB, aiB, langBtn, themeBtn, helpBtn, h('div.cc-menuwrap', menuBtn, menuPop));

    // ---- banners ----
    const banners = h('div.cc-banners');
    // ---- inspector ----
    const tabList = h('div.cc-tabs', { role: 'tablist', 'aria-label': t('tabs.aria') });
    const body = h('div.cc-panelbox');
    for (const id of TABS) {
      const b = h('button.cc-tab', { role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'data-testid': `tab-${id}`, onclick: () => setTab(id), onkeydown: (e) => tabKey(e, id) });
      tabEls[id] = b; tabList.append(b);
      const pe = h('div.cc-panel', { role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, tabindex: 0, hidden: true, 'data-testid': `panel-${id}` }, panels[id].el);
      panelEls[id] = pe; body.append(pe);
    }
    function tabKey(e, id) {
      const i = TABS.indexOf(id); let n = null;
      if (e.key === 'ArrowRight') n = TABS[(i + 1) % TABS.length]; else if (e.key === 'ArrowLeft') n = TABS[(i + TABS.length - 1) % TABS.length]; else if (e.key === 'Home') n = TABS[0]; else if (e.key === 'End') n = TABS[TABS.length - 1];
      if (n) { e.preventDefault(); setTab(n); tabEls[n].focus(); }
    }
    const insp = h('aside.cc-insp', { 'aria-label': t('insp.aria') }, tabList, body);
    const grid = h('div.cc-grid', map.pane, insp);
    const main = h('main.main.cc-main', banners, grid);
    fill(root, h('div.shell.no-side.cc', top, main));

    // ---- renderers ----
    const roleText = () => {
      const m = S.me; if (!m) return '';
      const parts = [roleLabel(m.role)]; if (m.role === 'dcp' && m.region) parts.push(regionName(m.region)); if (m.role === 'station') parts.push(m.station);
      return parts.join(' · ');
    };
    function renderTop() {
      const lr = lockedRegion(), opts = lr ? [lr] : ['All', 'Urban', ...REGIONS];
      fill(scopeBox, ...opts.map((r, i) => h('button.chip', { 'aria-pressed': String(S.scope === r), 'data-scope': r, title: lr ? t('scope.locked') : `${i + 1}`, onclick: () => { setScope(r); } }, r === 'All' ? t('scope.all') : regionName(r))));
      if (lr) scopeBox.prepend(ic('shield', 14));
      const p = statusPill(); pill.className = `badge cc-pill ${p.kind}`; fill(pill, h('span.dot' + (p.kind === 'good' ? '.good' : p.kind === 'bad' ? '.bad' : '.warn') + (p.live ? '.live' : '')), p.text); pill.title = p.title ?? '';
      updated.textContent = S.live?.updatedAt ? t('top.updated', { ago: agoText(S.live.updatedAt) }) : '';
      refreshBtn.hidden = !can('state.refresh');
      const m = S.me; roleB.textContent = roleText(); roleB.className = 'badge cc-role ' + (m?.role === 'viewer' ? '' : 'accent');
      if (m?.role === 'viewer') roleB.title = t('role.readonly');
      const q = S.quota, show = aiAvailable() && !!q; aiB.hidden = !show;
      if (show) { aiB.textContent = `AI ${q.used}/${q.limit}`; aiB.className = 'badge cc-aiq ' + (q.used >= q.limit ? 'bad' : q.used >= q.limit * 0.8 ? 'warn' : ''); aiB.title = t('ai.quota', { used: q.used, limit: q.limit }); }
      langBtn.textContent = S.lang === 'kn' ? 'English' : 'ಕನ್ನಡ';
      fill(themeBtn, ic(effectiveTheme() === 'dark' ? 'sun' : 'moon', 17));
      tickClock();
    }
    function tickClock() { clock.textContent = `${fmtH(istParts().h)} IST`; updated.textContent = S.live?.updatedAt ? t('top.updated', { ago: agoText(S.live.updatedAt) }) : ''; }
    function renderBanners() {
      const out = [];
      if (!S.conn.ok && S.conn.loaded !== undefined && (S.live || S.actions.length)) out.push(h('div.banner.bad', { role: 'alert', 'data-testid': 'banner-offline' }, ic('wifiOff', 16), h('span.grow', t('banner.offline', { time: S.live ? fmtH(istParts(S.live.updatedAt).h) : '–' })), h('button.btn.sm', { onclick: () => pollNow() }, t('retry'))));
      else if (!S.conn.ok) out.push(h('div.banner.bad', { role: 'alert', 'data-testid': 'banner-offline' }, ic('wifiOff', 16), h('span.grow', t('banner.offlineNoData')), h('button.btn.sm', { onclick: () => pollNow() }, t('retry'))));
      if (S.live?.stale && S.conn.ok) out.push(h('div.banner', { role: 'status', 'data-testid': 'banner-stale' }, ic('clock', 16), t('banner.stale', { time: fmtH(istParts(S.live.updatedAt).h) })));
      if (S.me?.flags.maintenance && S.me.role === 'admin') out.push(h('div.banner.info', { role: 'status' }, ic('wrench', 16), t('banner.maint')));
      if (S.mapMismatch) out.push(h('div.banner.bad', { role: 'alert' }, ic('alert', 16), t('banner.mismatch')));
      fill(banners, ...out);
    }
    function renderTabs() {
      const open = openActions(), esc = open.filter((a) => a.escalated).length;
      for (const id of TABS) {
        const b = tabEls[id], on = S.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on);
        fill(b, t(`tab.${id}`), id === 'actions' && open.length ? h('span.cc-count' + (esc ? '.bad' : ''), { 'data-testid': 'actions-count', 'aria-label': t('tab.actionsCount', { n: open.length }) }, open.length) : null);
        panelEls[id].hidden = !on;
      }
    }
    const dirty = new Set(['overview', 'station', 'actions', 'planner', 'works']);
    const runPanel = (id) => { dirty.delete(id); try { panels[id].update(); } catch (e) { console.error('panel', id, e); } };
    const typing = (id) => { const a = document.activeElement; return a && panelEls[id].contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'range'; }; // the replay slider must keep refreshing the panel while focused
    const flushActive = frame(() => {
      if (destroyed) return; const id = S.tab;
      if (dirty.has(id)) { if (typing(id) && !dirty.has('force' + id)) return; runPanel(id); }
    });
    for (const id of TABS) {
      on(panels[id].topics, () => { dirty.add(id); if (S.tab === id) flushActive(); });
      panelEls[id].addEventListener('focusout', () => { setTimeout(() => { if (dirty.has(id) && S.tab === id) flushActive(); }, 0); });
    }
    if (panels.planner.progressTopics) on(panels.planner.progressTopics, () => panels.planner.progress());
    on('tab', () => { renderTabs(); if (dirty.has(S.tab)) runPanel(S.tab); else flushActive(); });
    on(['view', 'me', 'live', 'conn', 'quota', 'lang', 'actions', 'result'], frame(() => { renderTop(); renderBanners(); renderTabs(); }));
    // apply lock on role load
    renderTop(); renderBanners(); renderTabs(); runPanel(S.tab);
    S._clock = setInterval(() => { tickClock(); }, 1000);
    S._minute = setInterval(() => emit('result'), 60000);
    function toggleTheme() { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); setTimeout(() => emit('view'), 0); }
    S.ui = { toggleTheme, showShortcuts, focusSlider: () => { setTab('overview'); setTimeout(() => panelEls.overview.querySelector('.cc-range')?.focus(), 30); } };
    function showShortcuts() { openShortcuts(); }
  });
  return { map, destroy() { destroyed = true; disposeSubs(); root._cleanup?.(); clearInterval(S._clock); clearInterval(S._minute); map.destroy(); } };
}

export function openShortcuts() {
  const rows = [['1', 'kbd.scope1'], ['2 – 8', 'kbd.scope26'], ['/', 'kbd.search'], ['[  ]', 'kbd.zoom'], ['R', 'kbd.replay'], ['Esc', 'kbd.esc'], ['?', 'kbd.help']];
  openDialog({ title: t('kbd.title'), testid: 'shortcuts', body: h('table.tbl', h('tbody', rows.map(([k, d]) => h('tr', h('td', ...k.split(' ').filter((x) => x !== '–' && x).map((x) => h('span.kbd', { style: { marginRight: '4px' } }, x)), k.includes('–') ? ' ' : null), h('td', t(d)))))) });
}

/** Global keyboard shortcuts (installed once). `getMap` returns the live map instance. */
export function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target, typing = el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
    if (typing || document.querySelector('.modal-bg') || !S.me || !S.mapRef) return;
    const k = e.key;
    if (/^[1-8]$/.test(k)) { const lr = lockedRegion(); if (lr) return; setScope(['All', 'Urban', ...REGIONS][+k - 1]); }
    else if (k === '/') { e.preventDefault(); S.mapRef.focusSearch(); }
    else if (k === '[') S.mapRef.zoomBy(1 / 1.6);
    else if (k === ']') S.mapRef.zoomBy(1.6);
    else if (k === 'r' || k === 'R') { if (S.replay == null) { setReplay(Math.round(curHour() * 4) / 4); S.ui?.focusSlider(); } else setReplay(null); }
    else if (k === '?') openShortcuts();
    else if (k === 'Escape') { if (S.sel) setSel(null); }
  });
}
