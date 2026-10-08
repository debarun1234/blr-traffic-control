// Post-sign-in welcome screen shared by the Control app and the Admin console.
// It greets the person by name (copy differs per role), runs the pre-entry checks (connection, data feed, AI; plus
// platform health for administrators) and only then lets them in. Nothing here blocks entry: a failed check is shown, not enforced.
import { h, icon } from './ui.mjs';

export const VARIANTS = ['commissioner', 'dcp', 'station', 'viewer', 'admin', 'admin-site'];

/** Part of day in India Standard Time. */
export const dayPart = (ms = Date.now()) => { const hr = new Date(ms + 19800000).getUTCHours(); return hr >= 5 && hr < 12 ? 'morning' : hr < 16 ? 'afternoon' : hr < 23 ? 'evening' : 'night'; };

/** "Debarun Ghosh" -> "Debarun"; "north.dcp@x" -> "North". */
export function firstName(name, email) {
  const n = String(name ?? '').trim();
  if (n) return n.split(/\s+/)[0];
  const local = String(email ?? '').split('@')[0].replace(/[0-9]+/g, ' ').split(/[._\-\s]+/).filter(Boolean)[0] ?? '';
  return local ? local[0].toUpperCase() + local.slice(1) : '';
}

const GREET = {
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Welcome' },
  kn: { morning: 'ಶುಭೋದಯ', afternoon: 'ಶುಭ ಮಧ್ಯಾಹ್ನ', evening: 'ಶುಭ ಸಂಜೆ', night: 'ಸ್ವಾಗತ' },
};
// {g} greeting, {name} first name, {region}, {station}, {stations} count
const COPY = {
  en: {
    commissioner: { h: '{g}, Commissioner {name}.', s: 'All of Bengaluru is in view: {stations} station territories, five regions, one picture.', c: 'Thank you for keeping this city moving.', go: 'Enter the control room' },
    dcp: { h: '{g}, DCP {name}.', s: '{region} division is ready: {stations} stations, their roads, incidents and works in one view.', c: 'Wishing you a smooth shift across {region}.', go: 'Enter the control room' },
    station: { h: '{g}, {name}.', s: '{station} station, ready for your shift. Your roads, incidents and works are lined up.', c: 'Stay safe out there, and thank you for the work you do on the ground.', go: 'Start my shift' },
    viewer: { h: '{g}, {name}.', s: 'You have a read-only view of Bengaluru’s modelled traffic.', c: 'Look around freely. Nothing you do here changes live operations.', go: 'Open the control room' },
    admin: { h: '{g}, {name}.', s: 'You are in as Administrator. The whole control room is yours to look over, and the Admin console is one click away.', c: 'Thank you for keeping the platform in order.', go: 'Enter the control room' },
    'admin-site': { h: 'Welcome to the engine room, {name}.', s: 'Users, feeds, probes and AI limits live here: everything that keeps the control room trustworthy.', c: 'Thank you for keeping it running.', go: 'Open the Admin console' },
    ui: {
      checking: 'Checking…', notYou: 'Not you? Sign out', daily: 'Quick check before you go in. The AI check runs once a day.', continue: 'Continue anyway',
      incidents: 'Active incidents', actions: 'Open actions', works: 'Works in force', users: 'Active users', connectors: 'Connectors healthy', aiToday: 'AI calls today', system: 'System checks',
      'row.api': 'Connection', 'row.data': 'Traffic data', 'row.ai': 'AI assistant', 'row.sys': 'System health', 'row.con': 'Connectors',
      api_ok: 'Reached the service in {ms} ms', api_fail: 'Cannot reach the service. The control room will show its offline screen.',
      data_ok: 'Updated {age} min ago · {mode}', data_stale: 'Data is {age} min old (limit {limit}). Figures may lag.', data_none: 'No data has been computed yet.',
      mode_sim: 'modelled', mode_live: 'live feed, modelled for roads without sensors', mode_replay: 'replay',
      ai_ok: 'Ready ({model}) · {when}', ai_off: 'Switched off · built-in advice still works', ai_degraded: 'Not answering right now · built-in advice still works', ai_capped: 'Today’s AI budget is used · built-in advice still works', ai_unconfigured: 'Not configured · built-in advice still works',
      when_cached: 'checked earlier today', when_now: 'checked just now',
      sys_ok: 'All {n} checks passed', sys_some: '{ok} passed, {warn} warning(s), {fail} failed', con_ok: '{enabled} enabled, none failing', con_bad: '{failing} of {total} failing', con_none: 'None set up yet',
      skipped: 'Not checked (service unreachable)',
    },
  },
  kn: {
    commissioner: { h: '{g}, ಆಯುಕ್ತರಾದ {name} ಅವರೇ.', s: 'ಇಡೀ ಬೆಂಗಳೂರು ನಿಮ್ಮ ಕಣ್ಣ ಮುಂದೆ: {stations} ಠಾಣೆ ವ್ಯಾಪ್ತಿಗಳು, ಐದು ವಿಭಾಗಗಳು, ಒಂದೇ ಚಿತ್ರ.', c: 'ಈ ನಗರವನ್ನು ಸಂಚಾರದಲ್ಲಿ ಇಟ್ಟಿರುವುದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.', go: 'ನಿಯಂತ್ರಣ ಕೊಠಡಿಗೆ ಪ್ರವೇಶಿಸಿ' },
    dcp: { h: '{g}, ಡಿಸಿಪಿ {name} ಅವರೇ.', s: '{region} ವಿಭಾಗ ಸಿದ್ಧವಾಗಿದೆ: {stations} ಠಾಣೆಗಳು, ಅವುಗಳ ರಸ್ತೆಗಳು, ಘಟನೆಗಳು ಮತ್ತು ಕಾಮಗಾರಿಗಳು ಒಂದೇ ನೋಟದಲ್ಲಿ.', c: '{region} ವಿಭಾಗದಲ್ಲಿ ನಿಮ್ಮ ಪಾಳಿ ಸುಗಮವಾಗಿರಲಿ.', go: 'ನಿಯಂತ್ರಣ ಕೊಠಡಿಗೆ ಪ್ರವೇಶಿಸಿ' },
    station: { h: '{g}, {name}.', s: '{station} ಠಾಣೆ, ನಿಮ್ಮ ಪಾಳಿಗೆ ಸಿದ್ಧ. ನಿಮ್ಮ ರಸ್ತೆಗಳು, ಘಟನೆಗಳು ಮತ್ತು ಕಾಮಗಾರಿಗಳು ಸಿದ್ಧವಾಗಿವೆ.', c: 'ಸುರಕ್ಷಿತವಾಗಿರಿ; ನೀವು ಮಾಡುವ ಕ್ಷೇತ್ರ ಕೆಲಸಕ್ಕೆ ಧನ್ಯವಾದಗಳು.', go: 'ನನ್ನ ಪಾಳಿ ಆರಂಭಿಸಿ' },
    viewer: { h: '{g}, {name}.', s: 'ಬೆಂಗಳೂರಿನ ಮಾದರಿ ಸಂಚಾರದ ಓದಲು-ಮಾತ್ರ ನೋಟ ನಿಮಗಿದೆ.', c: 'ಮುಕ್ತವಾಗಿ ನೋಡಿ. ಇಲ್ಲಿ ನೀವು ಮಾಡುವುದು ನೇರ ಕಾರ್ಯಾಚರಣೆಯನ್ನು ಬದಲಾಯಿಸುವುದಿಲ್ಲ.', go: 'ನಿಯಂತ್ರಣ ಕೊಠಡಿ ತೆರೆಯಿರಿ' },
    admin: { h: '{g}, {name}.', s: 'ನೀವು ನಿರ್ವಾಹಕರಾಗಿ ಒಳಗೆ ಇದ್ದೀರಿ. ಇಡೀ ನಿಯಂತ್ರಣ ಕೊಠಡಿ ನಿಮ್ಮ ವೀಕ್ಷಣೆಗೆ ಲಭ್ಯ; ನಿರ್ವಾಹಕ ಕನ್ಸೋಲ್ ಒಂದು ಕ್ಲಿಕ್ ದೂರದಲ್ಲಿದೆ.', c: 'ವೇದಿಕೆಯನ್ನು ಕ್ರಮವಾಗಿ ಇಟ್ಟಿರುವುದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.', go: 'ನಿಯಂತ್ರಣ ಕೊಠಡಿಗೆ ಪ್ರವೇಶಿಸಿ' },
    'admin-site': null,
    ui: {
      checking: 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…', notYou: 'ನೀವಲ್ಲವೇ? ಸೈನ್ ಔಟ್', daily: 'ಒಳಗೆ ಹೋಗುವ ಮೊದಲು ತ್ವರಿತ ಪರಿಶೀಲನೆ. AI ಪರಿಶೀಲನೆ ದಿನಕ್ಕೊಮ್ಮೆ ನಡೆಯುತ್ತದೆ.', continue: 'ಹೇಗಿದ್ದರೂ ಮುಂದುವರಿಸಿ',
      incidents: 'ಸಕ್ರಿಯ ಘಟನೆಗಳು', actions: 'ತೆರೆದ ಕ್ರಮಗಳು', works: 'ಜಾರಿಯಲ್ಲಿರುವ ಕಾಮಗಾರಿಗಳು', users: 'ಸಕ್ರಿಯ ಬಳಕೆದಾರರು', connectors: 'ಆರೋಗ್ಯಕರ ಕನೆಕ್ಟರ್‌ಗಳು', aiToday: 'ಇಂದಿನ AI ಕರೆಗಳು', system: 'ಸಿಸ್ಟಂ ಪರಿಶೀಲನೆಗಳು',
      'row.api': 'ಸಂಪರ್ಕ', 'row.data': 'ಸಂಚಾರ ದತ್ತಾಂಶ', 'row.ai': 'AI ಸಹಾಯಕ', 'row.sys': 'ಸಿಸ್ಟಂ ಆರೋಗ್ಯ', 'row.con': 'ಕನೆಕ್ಟರ್‌ಗಳು',
      api_ok: '{ms} ms ನಲ್ಲಿ ಸೇವೆ ತಲುಪಿದೆ', api_fail: 'ಸೇವೆಯನ್ನು ತಲುಪಲಾಗುತ್ತಿಲ್ಲ. ನಿಯಂತ್ರಣ ಕೊಠಡಿ ಆಫ್‌ಲೈನ್ ಪರದೆ ತೋರಿಸುತ್ತದೆ.',
      data_ok: '{age} ನಿಮಿಷದ ಹಿಂದೆ ನವೀಕರಿಸಲಾಗಿದೆ · {mode}', data_stale: 'ದತ್ತಾಂಶ {age} ನಿಮಿಷ ಹಳೆಯದು (ಮಿತಿ {limit}). ಅಂಕಿಅಂಶಗಳು ಹಿಂದುಳಿದಿರಬಹುದು.', data_none: 'ಇನ್ನೂ ದತ್ತಾಂಶ ಲೆಕ್ಕಹಾಕಿಲ್ಲ.',
      mode_sim: 'ಮಾದರಿ', mode_live: 'ನೇರ ಫೀಡ್, ಸೆನ್ಸರ್ ಇಲ್ಲದ ರಸ್ತೆಗಳಿಗೆ ಮಾದರಿ', mode_replay: 'ಮರುಪ್ರದರ್ಶನ',
      ai_ok: 'ಸಿದ್ಧ ({model}) · {when}', ai_off: 'ಆಫ್ ಆಗಿದೆ · ಅಂತರ್ನಿರ್ಮಿತ ಸಲಹೆ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ', ai_degraded: 'ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ · ಅಂತರ್ನಿರ್ಮಿತ ಸಲಹೆ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ', ai_capped: 'ಇಂದಿನ AI ಬಜೆಟ್ ಬಳಕೆಯಾಗಿದೆ · ಅಂತರ್ನಿರ್ಮಿತ ಸಲಹೆ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ', ai_unconfigured: 'ಸಂರಚಿಸಿಲ್ಲ · ಅಂತರ್ನಿರ್ಮಿತ ಸಲಹೆ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ',
      when_cached: 'ಇಂದು ಮುಂಚೆ ಪರಿಶೀಲಿಸಲಾಗಿದೆ', when_now: 'ಈಗಷ್ಟೇ ಪರಿಶೀಲಿಸಲಾಗಿದೆ',
      sys_ok: 'ಎಲ್ಲಾ {n} ಪರಿಶೀಲನೆಗಳು ಯಶಸ್ವಿ', sys_some: '{ok} ಯಶಸ್ವಿ, {warn} ಎಚ್ಚರಿಕೆ, {fail} ವಿಫಲ', con_ok: '{enabled} ಸಕ್ರಿಯ, ಯಾವುದೂ ವಿಫಲವಾಗಿಲ್ಲ', con_bad: '{total} ರಲ್ಲಿ {failing} ವಿಫಲ', con_none: 'ಇನ್ನೂ ಸೇರಿಸಿಲ್ಲ',
      skipped: 'ಪರಿಶೀಲಿಸಿಲ್ಲ (ಸೇವೆ ತಲುಪಲಾಗುತ್ತಿಲ್ಲ)',
    },
  },
};
const fmt = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

/** Pure: the words shown for a variant. Exported for tests. */
export function welcomeCopy({ variant, lang = 'en', name = '', email = '', hour, region = '', station = '', stations = 0 }) {
  const L = lang === 'kn' ? 'kn' : 'en', c = COPY[L][variant] ?? COPY.en[variant], who = firstName(name, email) || (L === 'kn' ? 'ಸ್ನೇಹಿತರೇ' : 'there');
  const g = GREET[L][dayPart(hour)], v = { g, name: who, region, station, stations };
  return { greeting: g, name: who, headline: fmt(c.h, v), sub: fmt(c.s, v), close: fmt(c.c, v), go: c.go, lang: L };
}

const ROW_ICON = { ok: 'check', warn: 'alert', fail: 'alert', off: 'pulse', wait: 'clock' };

/**
 * @param {HTMLElement} root
 * @param {{variant:string, lang?:string, user:{name?:string,email:string}, kicker:string, region?:string, station?:string, logo:string,
 *          preflight:Promise<any>, onEnter:()=>void, onSignOut:()=>void, util?:Node, art?:(canvas:HTMLCanvasElement)=>(()=>void)|void, now?:number}} o
 * @returns {{destroy:()=>void}}
 */
export function renderWelcome(root, o) {
  const L = o.lang === 'kn' && COPY.kn[o.variant] ? 'kn' : 'en', U = COPY[L].ui, admin = o.variant === 'admin-site', reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let destroyed = false, stopArt = null; const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if (!destroyed) fn(); }, reduce ? 0 : ms); timers.push(t); };

  const copy = welcomeCopy({ variant: o.variant, lang: L, name: o.user.name, email: o.user.email, hour: o.now, region: o.region, station: o.station, stations: o.stations ?? 53 });
  // headline: the name is set apart so it can carry the accent
  const at = copy.headline.indexOf(copy.name), head = h('h1.wl-h', { 'aria-live': 'polite' }, copy.headline.slice(0, at), h('span.wl-name', copy.name), copy.headline.slice(at + copy.name.length));

  const rows = (admin ? ['api', 'data', 'ai', 'sys', 'con'] : ['api', 'data', 'ai']).map((id) => {
    const st = h('span.wl-st', { 'aria-hidden': 'true' }, h('i.wl-spin')), t = h('b', U[`row.${id}`]), d = h('span.wl-rd', U.checking);
    return { id, el: h('li.wl-row.wait', { 'data-row': id, 'data-state': 'wait' }, st, h('div', t, d)), st, d };
  });
  const setRow = (r, state, text) => { r.el.className = `wl-row ${state}`; r.el.dataset.state = state; r.d.textContent = text; r.st.replaceChildren(icon(ROW_ICON[state] ?? 'check', 15)); };

  const statEls = [];
  const statTile = (key, label) => { const v = h('b.wl-n', '–'), tile = h('div.wl-stat', { 'data-stat': key }, v, h('span', label)); statEls.push({ key, v }); return tile; };
  const stats = admin
    ? [statTile('users', U.users), statTile('connectors', U.connectors), statTile('ai', U.aiToday), statTile('system', U.system)]
    : [statTile('incidents', U.incidents), statTile('actions', U.actions), statTile('works', U.works)];

  const goBtn = h('button.btn.primary.lg.wl-go', { type: 'button', disabled: true, 'data-testid': 'welcome-enter', onclick: () => { destroy(); o.onEnter(); } }, h('span.wl-gol', U.checking), icon('route', 17));
  const hint = h('p.wl-hint', U.daily);
  const canvas = admin ? null : h('canvas.wl-art', { 'aria-hidden': 'true' });
  const tiles = admin ? h('div.wl-ops', { 'aria-hidden': 'true' }, [['users', 'Users & roles'], ['plug', 'Connectors'], ['cpu', 'AI & cost'], ['pulse', 'Data feed'], ['gauge', 'System checks'], ['list', 'Audit log']].map(([ic, label], i) => h('div.wl-op', { style: { '--i': i } }, h('div.wl-opi', icon(ic, 26), h('span', label)), h('i')))) : null;

  const logo = h('div.wl-logo', h('i.wl-ring'), h('i.wl-ring.r2'), h('img', { src: o.logo, alt: '', width: 76, height: 76 }));
  const card = h('section.wl-card', { 'aria-label': copy.headline },
    h('div.row.between.nowrap', logo, o.util ?? null),
    h('div.wl-kick', h('span.wl-chip', o.kicker)), head, h('p.wl-sub', copy.sub),
    h('div.wl-stats' + (admin ? '.four' : ''), stats), h('ul.wl-checks', { 'aria-label': U.checking }, rows.map((r) => r.el)),
    h('p.wl-close', copy.close),
    h('div.wl-actions', goBtn, h('button.btn.ghost.wl-out', { type: 'button', onclick: () => { destroy(); o.onSignOut(); } }, U.notYou)), hint);
  const side = h('div.wl-side', h('div.wl-stage', canvas ?? tiles, h('div.wl-stagecap', h('b', admin ? 'Engine room' : o.kicker.split('·').pop().trim()), h('span.xs.faint', h('i.wl-live'), admin ? 'Live platform snapshot' : (L === 'kn' ? 'ಅನುಕರಣ ಟೆಲಿಮೆಟ್ರಿ, ನೇರ ಮಾಹಿತಿಯಲ್ಲ' : 'Simulated telemetry, not live data')))));
  root.replaceChildren(h('div.wl.wl-v-' + o.variant, { 'data-testid': 'welcome', 'data-variant': o.variant, role: 'main' }, card, side));
  root.querySelector('.wl-go')?.focus({ preventScroll: true });
  if (canvas && o.art) later(() => { try { stopArt = o.art(canvas) ?? null; } catch { /* decorative */ } }, 60);

  const countUp = (el, to, ms = 900) => {
    if (reduce || !Number.isFinite(to)) { el.textContent = Number.isFinite(to) ? String(to) : '–'; return; }
    const t0 = performance.now(); const step = (t) => { if (destroyed) return; const k = Math.min(1, (t - t0) / ms); el.textContent = String(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
  };

  const resolve = (pf) => {
    const when = (cached) => (cached ? U.when_cached : U.when_now);
    const results = {
      api: pf ? ['ok', fmt(U.api_ok, { ms: pf.api?.ms ?? '?' })] : ['fail', U.api_fail],
      data: !pf ? ['off', U.skipped] : pf.data?.ageMin == null ? ['warn', U.data_none] : pf.data.stale ? ['warn', fmt(U.data_stale, { age: pf.data.ageMin, limit: pf.data.limitMin })] : ['ok', fmt(U.data_ok, { age: pf.data.ageMin, mode: U[`mode_${pf.data.mode}`] ?? pf.data.mode })],
      ai: !pf ? ['off', U.skipped] : ({ ok: ['ok', fmt(U.ai_ok, { model: pf.ai.model ?? 'AI', when: when(pf.ai.cached) })], off: ['off', U.ai_off], capped: ['warn', U.ai_capped], degraded: ['warn', U.ai_degraded], unconfigured: ['off', U.ai_unconfigured] }[pf.ai?.status] ?? ['warn', U.ai_degraded]),
    };
    if (admin && pf?.platform) {
      const p = pf.platform, s = p.system, tot = s.ok + s.warn + s.fail;
      results.sys = s.fail ? ['fail', fmt(U.sys_some, s)] : s.warn ? ['warn', fmt(U.sys_some, s)] : ['ok', fmt(U.sys_ok, { n: tot })];
      results.con = !p.connectors.total ? ['off', U.con_none] : p.connectors.failing ? ['warn', fmt(U.con_bad, p.connectors)] : ['ok', fmt(U.con_ok, p.connectors)];
    } else if (admin) { results.sys = ['off', U.skipped]; results.con = ['off', U.skipped]; }
    rows.forEach((r, i) => later(() => setRow(r, ...(results[r.id] ?? ['wait', '–'])), 1100 + i * 420));
    const total = 1100 + rows.length * 420;
    later(() => {
      const g = pf?.glance, p = pf?.platform;
      for (const { key, v } of statEls) {
        if (key === 'users') countUp(v, p?.users.active); else if (key === 'connectors') countUp(v, p ? p.connectors.enabled - p.connectors.failing : NaN);
        else if (key === 'ai') countUp(v, p?.ai.calls); else if (key === 'system') countUp(v, p ? p.system.ok : NaN); else countUp(v, g?.[key] ?? NaN);
      }
      const bad = rows.some((r) => r.el.dataset.state === 'fail' || r.el.dataset.state === 'warn');
      goBtn.disabled = false; goBtn.querySelector('.wl-gol').textContent = !pf ? U.continue : copy.go; goBtn.classList.add('ready'); goBtn.focus({ preventScroll: true });
      hint.textContent = bad && pf ? '' : U.daily;
    }, total + 150);
  };
  Promise.resolve(o.preflight).then(resolve, () => resolve(null));

  function destroy() { destroyed = true; timers.forEach(clearTimeout); try { stopArt?.(); } catch { /* ignore */ } }
  return { destroy };
}
