// Assembles the map pane: canvas + overlays (search, layers, zoom, legend, tooltip, replay chip).
import { h } from '/vendor/ui.mjs';
import { S, on, emit, setSel, setTab, setReplay, lockedRegion, fatal2025, scopeStations } from '../state.mjs';
import { t, regionName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { createRenderer } from './renderer.mjs';
import { attachInteraction } from './interaction.mjs';
import { edgesBox } from '../analytics.mjs';
import { fmtH } from '/vendor/ui.mjs';
import { frame, fill } from '../util.mjs';

export function createMapPane() {
  const MD = S.MD, net = MD.net;
  const canvas = h('canvas.cc-canvas', { tabindex: 0, role: 'img', 'aria-label': t('map.aria'), 'data-testid': 'map' });
  const tip = h('div.cc-tip', { role: 'tooltip', hidden: true });
  const wrap = h('section.cc-map', { 'aria-label': t('map.region') }, canvas);
  const R = createRenderer(canvas);

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

  // layers popover
  const layerRow = (key, label) => h('label.cc-chk', h('input', { type: 'checkbox', checked: S.layers[key], onchange: (e) => { S.layers[key] = e.target.checked; R.dirty = true; } }), h('span', label));
  const shadeSel = h('select.select', { 'aria-label': t('layers.shade'), onchange: (e) => { S.layers.shade = e.target.value; R.dirty = true; } },
    ...['none', 'crash', 'speed'].map((v) => h('option', { value: v, selected: S.layers.shade === v }, t(`layers.shade.${v}`))));
  const layersPop = h('div.cc-pop', { id: 'cc-layers', hidden: true, role: 'group', 'aria-label': t('layers.title') },
    layerRow('cong', t('layers.cong')), layerRow('minor', t('layers.minor')), layerRow('stn', t('layers.stn')), layerRow('inc', t('layers.inc')), layerRow('works', t('layers.works')),
    h('div.field', h('label', t('layers.shade')), shadeSel));
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
    const C = R.colours(), rows = [['<0.50', 'legend.free'], ['0.50–0.75', 'legend.light'], ['0.75–0.95', 'legend.busy'], ['0.95–1.15', 'legend.slow'], ['1.15–1.50', 'legend.jam'], ['>1.50', 'legend.grid']];
    fill(legend, h('b.xs', t('legend.title')),
      ...rows.map((r, i) => h('div.cc-lg', h('i', { style: { background: C.cls[i] } }), h('span', t(r[1])), h('span.mono.faint', r[0]))),
      h('div.cc-lg', h('i', { style: { background: C['--nofeed'] } }), h('span', t('legend.nofeed'))),
      h('div.cc-lg', h('i.inc', '!'), h('span', t('legend.inc'))), h('div.cc-lg', h('i.wk'), h('span', t('legend.works'))));
  }

  // ---- tooltip ----
  function showTip({ e, si, mx, my, incident }) {
    let body = null;
    const res = S.result;
    if (e >= 0 && res) {
      const st = MD.ST[net.stn[e]]; if (R.regAlpha(st.ri) < 0.5) return hideTip();
      body = [h('b', MD.edgeName(e, t('road.unnamed'))), h('div.mono.sm', `${Math.round(res.spd[e])} km/h · v/c ${res.vc[e].toFixed(2)}`), h('div.faint.xs', `${st.n} · ${regionName(st.r)}`), incident ? h('div.xs.bad', t('tip.incident')) : null];
    } else if (si >= 0 && R.regAlpha(MD.ST[si].ri) > 0.5) {
      body = [h('b', MD.ST[si].n), h('div.faint.xs', `${regionName(MD.ST[si].r)} · ${t('kpi.fatal')}: ${fatal2025(si)}`)];
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
  on('lang', () => { drawLegend(); input.setAttribute('aria-label', t('map.search')); });
  const recolour = () => { R.refreshColours(); drawLegend(); };
  const mo = new MutationObserver(recolour); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener?.('change', recolour);
  (function loop() { if (R.dead) return; if (R.dirty && R.W) R.draw(); requestAnimationFrame(loop); })();
  R.destroy = () => { R.dead = true; ro.disconnect(); mo.disconnect(); mq.removeEventListener?.('change', recolour); document.removeEventListener('pointerdown', outside); };
  drawLegend(); refreshOverlays();
  R.pane = wrap; R.canvas = canvas; R.focusSearch = () => { search.classList.add('open'); input.focus(); input.select(); };
  R.zoomBy = (f) => R.zoomAt(R.W / 2, R.H / 2, f);
  return R;
}
