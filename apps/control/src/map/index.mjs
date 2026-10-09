// Assembles the map pane: canvas + overlays (search, layers, zoom, legend, tooltip, replay chip).
import { h } from '/vendor/ui.mjs';
import { S, on, emit, setSel, setTab, setReplay, lockedRegion, fatal2025, hasCrash, scopeStations, mapCfg, allowedViews, curView, setView, layerAllowed, layerOn } from '../state.mjs';
import { t, regionName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { createRenderer } from './renderer.mjs';
import { createGoogleBase } from './gmaps.mjs';
import { lsSet } from '../util.mjs';
import { toast } from '/vendor/ui.mjs';
import { attachInteraction } from './interaction.mjs';
import { edgesBox, speedBucket } from '../analytics.mjs';
import { fmtH } from '/vendor/ui.mjs';
import { frame, fill } from '../util.mjs';

export function createMapPane() {
  const MD = S.MD, net = MD.net;
  const canvas = h('canvas.cc-canvas', { tabindex: 0, role: 'img', 'aria-label': t('map.aria'), 'data-testid': 'map' });
  const tip = h('div.cc-tip', { role: 'tooltip', hidden: true });
  const wrap = h('section.cc-map', { 'aria-label': t('map.region') }, canvas);
  const R = createRenderer(canvas);
  const mapsKey = S.cfg?.mapsKey || '';
  const gbase = mapsKey ? createGoogleBase(wrap, R, { key: mapsKey, mapId: S.cfg?.mapsMapId, origin: MD.map.o, scale: MD.map.s, onChange: () => drawLegend(), onFail: (m) => { S.layers.base = 'plain'; lsSet('blr-base', 'plain'); baseSel && (baseSel.value = 'plain'); toast(m, 'bad', 6000); } }) : null;
  R.baseOn = () => !!gbase?.active;
  let baseSel = null;

  // ---- overlays ----
  const roadNames = []; { const seen = new Set(); net.map.n.forEach((n, i) => { if (net.roads.has(i) && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); roadNames.push({ i, n, low: n.toLowerCase() }); } }); }
  const input = h('input.input.cc-q', { type: 'search', id: 'cc-search', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'cc-results', 'aria-autocomplete': 'list', 'aria-label': t('map.search') });
  const results = h('div.cc-results', { id: 'cc-results', role: 'listbox', hidden: true, 'aria-label': t('map.search') });
  const searchBtn = h('button.btn.sm.cc-searchbtn', { 'aria-label': t('map.search'), onclick: () => { search.classList.toggle('open'); if (search.classList.contains('open')) input.focus(); } }, ic('search', 16));
  const search = h('div.cc-search', searchBtn, h('span.cc-qi', ic('search', 15)), input, results);
  let opts = [], active = -1;

  function runSearch() {
    const v = input.value.trim().toLowerCase(); fill(results); opts = []; active = -1;
    if (v.length < 2) { results.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    const lr = lockedRegion();
    for (const s of MD.ST.filter((s) => s.n.toLowerCase().includes(v) && (!lr || s.r === lr)).slice(0, 6)) opts.push({ kind: 'st', i: s.i, label: s.n, sub: regionName(s.r) });
    let nR = 0;
    for (const r of roadNames) { if (nR >= 6) break; if (r.low.includes(v) && [...net.roads.get(r.i).keys()].some((si) => !lr || MD.ST[si].r === lr)) { opts.push({ kind: 'rd', i: r.i, label: r.n, sub: t('search.road') }); nR++; } }
    if (!opts.length) results.append(h('div.cc-opt.empty', t('search.none')));
    opts.forEach((o, k) => results.append(h('div.cc-opt', { role: 'option', id: `cc-o${k}`, 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); choose(o); } }, h('span', o.label), h('span.faint.xs', o.sub))));
    results.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function mark() { [...results.querySelectorAll('[role=option]')].forEach((el, k) => el.setAttribute('aria-selected', String(k === active))); input.setAttribute('aria-activedescendant', active >= 0 ? `cc-o${active}` : ''); }
  function choose(o) {
    if (o.kind === 'st') { setSel({ t: 'st', i: o.i }); R.fitBox(MD.ST[o.i].box, 0.25); }
    else {
      const lr = lockedRegion(), es = []; for (const [si, l] of net.roads.get(o.i)) if (!lr || MD.ST[si].r === lr) es.push(...l);
      // include case-variant spellings of the same road
      if (es.length) { setSel({ t: 'edge', e: es[0] }); R.fitBox(edgesBox(net, MD.DB, es), 0.15); }
    }
    setTab('station'); input.value = ''; results.hidden = true; input.setAttribute('aria-expanded', 'false'); search.classList.remove('open'); R.dirty = true;
  }
  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(opts.length - 1, active + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { const o = opts[Math.max(0, active)]; if (o) choose(o); }
    else if (e.key === 'Escape') { input.value = ''; results.hidden = true; input.setAttribute('aria-expanded', 'false'); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 120));

  // layers popover: one "view" (what the map is for) + the overlays on top of it. What is offered is set by the admin (settings.map).
  const layerRow = (key) => (!layerAllowed(key) ? null : h('label.cc-chk', h('input', { type: 'checkbox', 'data-testid': 'layer-' + key, checked: S.layers[key], onchange: (e) => { S.layers[key] = e.target.checked; R.dirty = true; } }), h('span', h('b', t(`layers.${key}`)), h('small', t(`layers.${key}.d`)))));
  if (gbase) baseSel = h('select.select', { 'aria-label': t('layers.base'), 'data-testid': 'base-select', onchange: (e) => { S.layers.base = e.target.value; lsSet('blr-base', e.target.value); gbase.set(e.target.value); } },
    ...['plain', 'roadmap', 'hybrid'].map((v) => h('option', { value: v, selected: S.layers.base === v }, t(`layers.base.${v}`))));
  const gtRow = () => (!layerAllowed('gtraffic') ? null : h('label.cc-chk', { 'data-testid': 'gtraffic-row' }, h('input', { type: 'checkbox', 'data-testid': 'gtraffic', checked: S.layers.gtraffic, onchange: (e) => { S.layers.gtraffic = e.target.checked; lsSet('blr-gtraffic', e.target.checked ? '1' : '0'); gbase?.setTraffic(e.target.checked); } }), h('span', h('b', t('layers.gtraffic')), h('small', t('layers.gtraffic.d')))));
  const layersPop = h('div.cc-pop', { id: 'cc-layers', hidden: true, role: 'group', 'aria-label': t('layers.title') });
  let popSig = '';
  const viewOpt = (v, cur) => h('label.cc-opt', { 'data-testid': 'view-' + v }, h('input', { type: 'radio', name: 'cc-view', value: v, checked: cur === v, onchange: () => { setView(v); popSig = sigOf(); drawLegend(); R.dirty = true; } }), h('span', h('b', t(`view.${v}.t`)), h('small', t(`view.${v}.d`))));
  const sigOf = () => JSON.stringify([S.lang, allowedViews(), curView(), mapCfg().layers, !!baseSel]);
  function renderLayers() {
    const cur = curView(); popSig = sigOf();
    fill(layersPop, h('div.cc-sec', t('view.title')), ...allowedViews().map((v) => viewOpt(v, cur)),
      h('div.cc-sec', t('layers.show')), layerRow('minor'), layerRow('stn'), layerRow('inc'), layerRow('works'),
      ...(baseSel ? [h('div.cc-sec', t('layers.base')), baseSel, gtRow()] : []));
  }
  const layersBtn = h('button.btn.sm.cc-layersbtn', { 'aria-expanded': 'false', 'aria-controls': 'cc-layers', onclick: () => { layersPop.hidden = !layersPop.hidden; layersBtn.setAttribute('aria-expanded', String(!layersPop.hidden)); } }, ic('layers', 16), h('span.lbl', t('layers.title')));
  const outside = (e) => { if (!layersPop.hidden && !layersPop.contains(e.target) && !layersBtn.contains(e.target)) { layersPop.hidden = true; layersBtn.setAttribute('aria-expanded', 'false'); } };
  document.addEventListener('pointerdown', outside);
  const tools = h('div.cc-tools', search, h('div.cc-layers', layersBtn, layersPop));

  const zoom = h('div.cc-zoom', { role: 'group', 'aria-label': t('map.zoom') },
    h('button', { 'aria-label': t('map.zoomIn'), title: t('map.zoomIn') + ' ]', onclick: () => R.zoomAt(R.W / 2, R.H / 2, 1.6) }, ic('plus', 18)),
    h('button', { 'aria-label': t('map.zoomOut'), title: t('map.zoomOut') + ' [', onclick: () => R.zoomAt(R.W / 2, R.H / 2, 1 / 1.6) }, ic('minus', 18)),
    h('button', { 'aria-label': t('map.fit'), title: t('map.fit'), onclick: () => R.fitScope() }, ic('fit', 18)));

  const legend = h('div.cc-legend', { 'aria-label': t('legend.title') });
  const note = h('div.cc-note', t('map.note'));
  const replayChip = h('div.cc-replaychip', { hidden: true, role: 'status' });
  const loading = h('div.cc-loading', { hidden: true, role: 'status' }, h('span.dot.live'), h('span', t('map.loading')));
  wrap.append(tools, zoom, legend, note, replayChip, loading, tip);

  function drawLegend() {
    const C = R.colours(), v = curView(), cfg = mapCfg(), lg = (col, label, val) => h('div.cc-lg', h('i', { style: { background: col } }), h('span', label), h('span.mono.faint', val ?? ''));
    let rows = [], top = null;
    if (v === 'traffic') {
      rows = [['<0.50', 'legend.free'], ['0.50–0.75', 'legend.light'], ['0.75–0.95', 'legend.busy'], ['0.95–1.15', 'legend.slow'], ['1.15–1.50', 'legend.jam'], ['>1.50', 'legend.grid']].map((r, i) => lg(C.cls[i], t(r[1]), r[0]));
      rows.push(lg(C['--nofeed'], t('legend.nofeed')));
    } else if (v === 'safety') {
      const cs = cfg.crashScale, steps = [0, 0.25, 0.5, 0.75, 1];
      rows = steps.map((q) => h('div.cc-lg', h('i', { style: { background: C['--c4'], opacity: 0.07 + 0.55 * q, height: '10px' } }), h('span', q === 0 ? t('legend.safety.none') : ''), h('span.mono.faint', q === 0 ? '0' : q === 1 ? `≥${cs}` : `≥${Math.round(q * cs)}`)));
      rows.push(lg(C['--nofeed'], t('legend.nodata')));
      const t3 = scopeStations().filter((s) => hasCrash(s.i)).sort((a, b) => fatal2025(b.i) - fatal2025(a.i)).slice(0, 3);
      top = t3.length ? t('legend.top', { list: t3.map((s) => `${s.n} ${fatal2025(s.i)}`).join(' · ') }) : null;
    } else {
      const b = cfg.speedBands, ramp = [C['--c4'], C['--c3'], C['--c2'], C['--c1'], C['--c0']], lab = [`<${b.slow}`, `${b.slow}–${b.moderate}`, `${b.moderate}–${b.good}`, `${b.good}–${b.fast}`, `≥${b.fast}`];
      rows = ramp.map((c, i) => h('div.cc-lg', h('i', { style: { background: c, opacity: 0.7, height: '10px' } }), h('span', t(['legend.speed.crawl', 'legend.slow', 'legend.speed.ok', 'legend.speed.good', 'legend.speed.fast'][i])), h('span.mono.faint', lab[i])));
      const sl = scopeStations().filter((s) => S.sum?.per[s.i]?.speed != null).sort((a, c) => S.sum.per[a.i].speed - S.sum.per[c.i].speed).slice(0, 3);
      top = sl.length ? t('legend.slowest', { list: sl.map((s) => `${s.n} ${Math.round(S.sum.per[s.i].speed)}`).join(' · ') }) : null;
    }
    if (v === 'traffic' && R.baseOn()) { // Google basemap: model draws only congested main roads, in a colour Google does not use
      rows = R.gmColours.map((c, i) => lg(c, t(['legend.slow', 'legend.jam', 'legend.grid'][i]), ['0.95–1.15', '1.15–1.50', '>1.50'][i]));
      top = t('legend.gm');
    }
    const marks = [layerOn('inc') ? h('div.cc-lg', h('i.inc', '!'), h('span', t('legend.inc'))) : null, layerOn('works') ? h('div.cc-lg', h('i.wk'), h('span', t('legend.works'))) : null];
    fill(legend, h('b.xs', t(`view.${v}.t`)), h('div.faint.cc-lgd', t(`view.${v}.d`)), ...rows, top ? h('div.cc-lgt', top) : null, h('div.cc-lgu', t(`view.${v}.use`)), ...marks);
  }

  // ---- tooltip ----
  function showTip({ e, si, mx, my, incident }) {
    let body = null;
    const res = S.result;
    if (e >= 0 && res) {
      const st = MD.ST[net.stn[e]]; if (R.regAlpha(st.ri) < 0.5) return hideTip();
      body = [h('b', MD.edgeName(e, t('road.unnamed'))), h('div.mono.sm', `${Math.round(res.spd[e])} km/h · v/c ${res.vc[e].toFixed(2)}`), h('div.faint.xs', `${st.n} · ${regionName(st.r)}`), incident ? h('div.xs.bad', t('tip.incident')) : null];
    } else if (si >= 0 && R.regAlpha(MD.ST[si].ri) > 0.5) {
      const sp = S.sum?.per[si]?.speed;
      body = [h('b', MD.ST[si].n), h('div.faint.xs', `${regionName(MD.ST[si].r)} · ${t('kpi.fatal')}: ${hasCrash(si) ? fatal2025(si) : '–'}${curView() === 'speed' && sp != null ? ` · ${Math.round(sp)} km/h` : ''}`)];
    }
    if (!body) return hideTip();
    fill(tip, ...body); tip.hidden = false;
    tip.style.left = Math.min(mx + 14, R.W - 210) + 'px'; tip.style.top = Math.min(my + 14, R.H - 80) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  attachInteraction(canvas, R, { showTip, hideTip });

  // ---- sizing & lifecycle ----
  const ro = new ResizeObserver(() => { const first = !R.W; R.resize(wrap.clientWidth, wrap.clientHeight); if (first) { if (S.viewKeep) { R.view = { ...S.viewKeep }; S.viewKeep = null; } else R.fitScope(true); } });
  ro.observe(wrap);
  const redraw = () => { R.dirty = true; };
  const refreshOverlays = frame(() => {
    const rep = S.replay != null;
    replayChip.hidden = !rep;
    if (rep) fill(replayChip, h('span.badge.warn', t('pill.replay')), h('span.mono', `${fmtH(S.replay)} IST`), S.replayBusy ? h('span.faint.xs', t('computing')) : null, h('button.btn.sm', { onclick: () => setReplay(null) }, t('replay.back')));
    loading.hidden = !!S.result || !S.conn.ok;
  });
  on(['result', 'view', 'incidents', 'works', 'crash', 'live', 'me', 'lang'], () => { redraw(); refreshOverlays(); });
  on('scope', () => R.fitScope());
  on('lang', () => { renderLayers(); drawLegend(); input.setAttribute('aria-label', t('map.search')); });
  // admin changes (views, layers, thresholds) arrive with /me; rebuild the popover only when something it shows has changed so focus is not lost
  on(['me', 'view'], () => { if (sigOf() !== popSig) renderLayers(); gbase?.setTraffic(layerOn('gtraffic')); drawLegend(); R.dirty = true; });
  on(['result', 'scope', 'crash'], () => { if (curView() !== 'traffic') drawLegend(); });
  renderLayers();
  const recolour = () => { R.refreshColours(); drawLegend(); };
  const mo = new MutationObserver(recolour); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener?.('change', recolour);
  (function loop() { if (R.dead) return; if (R.dirty && R.W) { R.draw(); gbase?.sync(); } requestAnimationFrame(loop); })();
  R.destroy = () => { R.dead = true; gbase?.destroy(); ro.disconnect(); mo.disconnect(); mq.removeEventListener?.('change', recolour); document.removeEventListener('pointerdown', outside); };
  drawLegend(); refreshOverlays(); if (gbase && S.layers.base !== 'plain') { gbase.setTraffic(layerOn('gtraffic')); gbase.set(S.layers.base); }
  R.pane = wrap; R.canvas = canvas; R.focusSearch = () => { search.classList.add('open'); input.focus(); input.select(); };
  R.zoomBy = (f) => R.zoomAt(R.W / 2, R.H / 2, f);
  return R;
}
