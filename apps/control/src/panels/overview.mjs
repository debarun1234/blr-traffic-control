// Overview: KPIs, typical-day timeline + replay, region / station tables, busiest roads.
import { h, fmtH } from '/vendor/ui.mjs';
import { istParts } from '/vendor/shared.mjs';
import { S, on, setScope, setSel, setTab, setReplay, curHour, incidentsAt, openActions, inScope, scopeStations, fatal2025, hasCrash, myStation } from '../state.mjs';
import { scopeSum, topRoads, colourClass, bandKm, REGIONS } from '../analytics.mjs';
import { t, regionName, agoText } from '../i18n.mjs';
import { reconcile, clear, fill } from '../util.mjs';
import { kpi, kpiSkeleton, sectionTitle, scopeLabel, speedTag, emptyState, lockNote } from './common.mjs';
import { createBriefCard } from './brief.mjs';

export function createOverview(map) {
  const root = h('div.cc-body');
  const head = h('div.cc-sec.cc-head'), kpis = h('div.cc-kpis', { 'data-testid': 'kpis' }), dq = h('div.cc-dq');
  const brief = createBriefCard();
  // timeline
  const tlSub = h('span.xs.faint', t('tl.sub'));
  const tlLegend = h('div.row.xs.cc-tllegend', { 'data-testid': 'tl-legend' });
  const tl = h('canvas.cc-tl', { role: 'img', 'aria-label': t('tl.aria') });
  const slider = h('input.cc-range', { type: 'range', min: 0, max: 95, step: 1, value: 0, 'aria-label': t('replay.slider'), 'data-testid': 'replay-slider' });
  const back = h('button.btn.sm', { onclick: () => setReplay(null), 'data-testid': 'replay-back' }, t('replay.back'));
  const tlCard = h('div.card.tight', h('div.cc-sec', h('h3', t('tl.title')), tlSub), tlLegend, tl,
    h('div.row.nowrap.cc-replayrow', slider, back), h('div.xs.faint', { 'data-testid': 'replay-note' }));
  const tbl = h('div.tbl-wrap'), table = h('table.tbl.cc-tbl'), thead = h('thead'), tbody = h('tbody');
  table.append(thead, tbody); tbl.append(table);
  const tblTitle = h('div'), roadsTitle = h('div'), roads = h('div.cc-roads');
  root.append(head, kpis, dq, brief, tlCard, tblTitle, tbl, roadsTitle, roads);

  slider.addEventListener('input', () => setReplay(+slider.value / 4));
  tl.addEventListener('click', (e) => { const r = tl.getBoundingClientRect(); setReplay(Math.max(0, Math.min(23.75, Math.round(((e.clientX - r.left - 4) / (r.width - 8)) * 96) / 4))); });

  // One series pair for the current selection: the model's usual speed per hour and today's measured speed per tick.
  function tlSeries() {
    const sel = S.sel, si = sel ? (sel.t === 'st' ? sel.i : S.MD.net.stn[sel.e]) : null, sc = S.scope;
    const spd = S.layers.metric === 'speed', f = spd ? 'speed' : 'congPct';
    const usual = S.tlSum.map((m) => (m ? (si != null ? m.per[si]?.[f] : sc === 'All' ? m.city[f] : sc === 'Urban' ? m.urban[f] : m.reg[sc]?.[f]) ?? null : null));
    const today = [];
    for (const p of S.hist.points) { const o = spd ? p : p.cg ?? {}; const v = si != null ? o.st?.[si] : sc === 'All' ? o.city : sc === 'Urban' ? o.urban : o.reg?.[sc]; if (v != null) { const q = istParts(p.t); today.push([q.h, v]); } }
    return { usual, today, spd, name: si != null ? S.MD.ST[si].n : scopeLabel() };
  }
  const uAt = (u, hr) => { const i = Math.min(22.999, Math.max(0, hr)), a = u[Math.floor(i)], b = u[Math.floor(i) + 1]; return a == null ? null : b == null ? a : a + (b - a) * (i - Math.floor(i)); };

  function drawTL() {
    const w = tl.clientWidth; if (!w) return; const hh = 92, d = Math.min(2, window.devicePixelRatio || 1);
    tl.width = w * d; tl.height = hh * d; const g = tl.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const cs = getComputedStyle(document.documentElement), line = cs.getPropertyValue('--line').trim(), ink3 = cs.getPropertyValue('--ink-3').trim(), acc = cs.getPropertyValue('--accent').trim(), bad = cs.getPropertyValue('--bad').trim(), good = cs.getPropertyValue('--good').trim(), font = cs.getPropertyValue('--mono').trim();
    g.strokeStyle = line; g.fillStyle = ink3; g.font = `10px ${font}`; g.textAlign = 'center';
    for (let hr = 0; hr <= 24; hr += 6) { const x = (hr / 24) * (w - 8) + 4; g.beginPath(); g.moveTo(x, 6); g.lineTo(x, hh - 18); g.stroke(); g.fillText(String(hr).padStart(2, '0'), Math.min(w - 8, Math.max(8, x)), hh - 5); }
    const { usual, today, spd, name } = tlSeries(), nowH = curHour(); tlSub.textContent = t(spd ? 'tl.sub' : 'tl.subCong');
    const haveU = usual.filter((v) => v != null);
    if (haveU.length < 2) { g.fillText(t('computing'), w / 2, hh / 2 - 6); }
    else {
      const all = [...haveU, ...today.map((p) => p[1])], lo = spd ? Math.min(...all) - 2 : Math.max(0, Math.min(...all) - 2), hi = Math.max(...all) + 2, X = (hr) => (hr / 24) * (w - 8) + 4, Y = (v) => 6 + (hh - 26) * (1 - (v - lo) / (hi - lo));
      // gap between today and usual: red where slower than usual, green where faster
      for (let k = 1; k < today.length; k++) {
        const [h0, v0] = today[k - 1], [h1, v1] = today[k]; if (h1 - h0 > 1.5 || h1 < h0) continue;
        const u0 = uAt(usual, h0), u1 = uAt(usual, h1); if (u0 == null || u1 == null) continue;
        g.beginPath(); g.moveTo(X(h0), Y(v0)); g.lineTo(X(h1), Y(v1)); g.lineTo(X(h1), Y(u1)); g.lineTo(X(h0), Y(u0)); g.closePath();
        g.globalAlpha = 0.22; g.fillStyle = ((v0 + v1) < (u0 + u1)) === spd ? bad : good; g.fill(); g.globalAlpha = 1;
      }
      g.beginPath(); let first = true; usual.forEach((v, i) => { if (v == null) return; first ? g.moveTo(X(i), Y(v)) : g.lineTo(X(i), Y(v)); first = false; });
      g.setLineDash([4, 3]); g.lineWidth = 1.6; g.strokeStyle = ink3; g.lineJoin = 'round'; g.stroke(); g.setLineDash([]);
      if (today.length) { g.beginPath(); today.forEach(([hr, v], i) => (i ? g.lineTo(X(hr), Y(v)) : g.moveTo(X(hr), Y(v)))); g.lineWidth = 2.2; g.strokeStyle = acc; g.stroke(); }
    }
    const x = (nowH / 24) * (w - 8) + 4; g.strokeStyle = bad; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, hh - 18); g.stroke();
    g.fillStyle = bad; g.beginPath(); g.arc(x, 4, 3, 0, 7); g.fill();
    const sw = (c, dash) => h('i.sw', { style: { background: dash ? 'transparent' : c, borderTop: dash ? `2px dashed ${c}` : '', height: dash ? '0' : '3px', width: '16px', display: 'inline-block', verticalAlign: 'middle', borderRadius: '2px' } });
    const nowV = today.length && S.replay == null ? today[today.length - 1][1] : null, u = today.length ? uAt(usual, today[today.length - 1][0]) : null;
    fill(tlLegend, h('span.muted', name), h('span', sw(acc), ' ', t('tl.actual')), h('span', sw(ink3, true), ' ', t('tl.usual')),
      nowV != null && u != null ? h('span.mono', { 'data-testid': 'tl-delta', style: { color: (spd ? nowV < u * 0.95 : nowV > u + 3) ? bad : (spd ? nowV > u * 1.05 : nowV < u - 3) ? good : '' } }, spd ? t('tl.nowVs', { now: Math.round(nowV), usual: Math.round(u), pct: `${nowV >= u ? '+' : ''}${Math.round(((nowV - u) / u) * 100)}` }) : t('tl.nowVsCong', { now: Math.round(nowV), usual: Math.round(u), diff: `${nowV >= u ? '+' : ''}${Math.round(nowV - u)}` })) : today.length < 2 ? h('span.faint', t('tl.building')) : null);
  }

  function update() {
    const res = S.result, net = S.MD.net, MD = S.MD, h0 = curHour(), rep = S.replay != null;
    fill(head, h('h2', scopeLabel()), h('div.row', rep ? h('span.badge.warn', t('pill.replay')) : null, h('span.mono.muted', `${fmtH(h0)} IST`)));
    // KPIs
    let sm = scopeSum(S.sum, S.scope);
    if (!rep && S.scope === 'All' && S.live?.city) sm = { speed: S.live.city.speed, congPct: S.live.city.congPct };
    const incs = incidentsAt(h0).filter((x) => inScope(MD.ST[x.stn]?.r)), oa = openActions().filter((a) => inScope(a.region)), es = oa.filter((a) => a.escalated);
    const fat = scopeStations().reduce((a, s) => a + fatal2025(s.i), 0);
    const spdM = S.layers.metric === 'speed'; let slowPct = 0;
    if (spdM && res) { const b = bandKm(net, res.vc, res.spd, 'speed', (si) => inScope(MD.ST[si].r)); slowPct = b.tot ? (100 * (b.km[2] + b.km[3])) / b.tot : 0; }
    const val = (n, u) => h('span', n, u ? h('small', u) : null);
    fill(kpis, 
      res && sm ? kpi(t('kpi.speed'), val(Math.round(sm.speed ?? 0), ' km/h'), { id: 'speed' }) : kpiSkeleton(t('kpi.speed')),
      res && sm ? (spdM ? kpi(t('kpi.slow'), val(Math.round(slowPct), '%'), { id: 'cong' }) : kpi(t('kpi.cong'), val(Math.round(sm.congPct), '%'), { id: 'cong' })) : kpiSkeleton(t(spdM ? 'kpi.slow' : 'kpi.cong')),
      res ? kpi(t('kpi.inc'), String(incs.length), { id: 'inc' }) : kpiSkeleton(t('kpi.inc')),
      S.conn.loaded ? kpi(t('kpi.open'), String(oa.length), { id: 'open', sub: rep ? t('kpi.liveOnly') : '' }) : kpiSkeleton(t('kpi.open')),
      S.conn.loaded ? kpi(t('kpi.esc'), String(es.length), { tone: es.length ? 'bad' : '', id: 'esc' }) : kpiSkeleton(t('kpi.esc')),
      kpi(t('kpi.fatal'), scopeStations().some((s) => hasCrash(s.i)) ? String(fat) : '–', { id: 'fatal' }));
    // data quality
    const L = S.live, cal = L?.calibration;
    fill(dq, h('span.dot' + (L && !L.stale && S.conn.ok ? '.good' : '.warn')),
      h('span', L ? [t(`mode.${L.mode}.long`, { probes: cal?.probes ?? 0 }), ' ', cal && cal.rmsePct != null ? t('dq.cal', { probes: cal.probes ?? '–', rmse: cal.rmsePct.toFixed(1) }) : t('dq.uncal'), ' ', L.updatedAt ? t('dq.updated', { ago: agoText(L.updatedAt) }) : ''] : t('loading')));
    // timeline
    slider.value = String(Math.round(h0 * 4)); slider.setAttribute('aria-valuetext', `${fmtH(h0)} IST`);
    back.hidden = !rep; tlCard.querySelector('[data-testid=replay-note]').textContent = rep ? t('replay.note') : t('tl.live');
    // table
    const lr = S.scope !== 'All' && S.scope !== 'Urban';
    fill(thead, h('tr', h('th', lr ? t('col.station') : t('col.region')), h('th.n', t('col.speed')), h('th.n', t('col.cong')), h('th.n', lr ? t('col.fatal') : t('col.inc')), lr ? null : h('th.n', t('col.fatal'))));
    fill(tblTitle, sectionTitle(lr ? t('sec.stations', { n: scopeStations().length }) : t('sec.regions')));
    const perSt = (i) => (!rep && L?.stations?.[i]) ? { speed: L.stations[i].speed, cong: L.stations[i].cong } : (S.sum ? { speed: S.sum.per[i].speed, cong: S.sum.per[i].congPct } : null);
    if (!lr) {
      const rows = REGIONS.filter((r) => inScope(r)).map((r) => {
        const rs = S.sum?.reg[r], ic = incidentsAt(h0).filter((x) => MD.ST[x.stn]?.r === r).length, fa = MD.ST.filter((s) => s.r === r).reduce((a, s) => a + fatal2025(s.i), 0);
        return { key: r, sig: `${rs?.speed?.toFixed(1)}|${rs?.congPct?.toFixed(1)}|${ic}|${fa}|${S.lang}|${S.result?.kind}`, r, rs, ic, fa };
      });
      reconcile(tbody, rows, (x) => x.key, (x) => x.sig, (x) => h('tr.click', { tabindex: 0, 'data-testid': 'row-' + x.r, onclick: () => setScope(x.r), onkeydown: (e) => { if (e.key === 'Enter') setScope(x.r); } },
        h('td', h('b', regionName(x.r)), ' ', h('span.faint.xs', MD.ST.filter((s) => s.r === x.r).length)),
        h('td.n', x.rs?.speed != null ? Math.round(x.rs.speed) : '…'), h('td.n', x.rs ? Math.round(x.rs.congPct) + '%' : '…'), h('td.n', x.ic), h('td.n', MD.ST.some((s) => s.r === x.r && hasCrash(s.i)) ? x.fa : '–')));
    } else {
      const st = scopeStations().sort((a, b) => fatal2025(b.i) - fatal2025(a.i)).map((s) => { const p = perSt(s.i); return { key: s.i, sig: `${p?.speed?.toFixed?.(1)}|${p?.cong?.toFixed?.(1)}|${fatal2025(s.i)}|${myStation() === s.i}`, s, p }; });
      reconcile(tbody, st, (x) => x.key, (x) => x.sig, (x) => h('tr.click', { tabindex: 0, onclick: () => { setSel({ t: 'st', i: x.s.i }); map.fitBox(x.s.box, 0.25); setTab('station'); }, onkeydown: (e) => { if (e.key === 'Enter') { setSel({ t: 'st', i: x.s.i }); setTab('station'); } } },
        h('td', x.s.n, myStation() === x.s.i ? h('span.badge.accent', { style: { marginLeft: '6px' } }, t('badge.mine')) : null),
        h('td.n', x.p?.speed != null ? Math.round(x.p.speed) : '–'), h('td.n', x.p ? Math.round(x.p.cong) + '%' : '…'), h('td.n', hasCrash(x.s.i) ? fatal2025(x.s.i) : '–')));
    }
    // roads
    fill(roadsTitle, sectionTitle(t('sec.topRoads')));
    if (!res) clear(roads).append(h('div.skel', { style: { height: '120px' } }));
    else {
      const list = topRoads(net, res.vc, res.spd, { filter: (s) => inScope(MD.ST[s].r), n: 8 });
      clear(roads).append(h('div.cc-list', list.map((o) => h('button.cc-li', { onclick: () => pickEdge(o.e) },
        h('span.grow', h('span.cc-li-t', MD.NAMES[o.nameIdx]), h('span.xs.faint.cc-li-s', MD.ST[o.stn].n)), speedTag(o.speed, colourClass(o.vc))))));
      if (!list.length) roads.append(emptyState(t('empty.roads')));
    }
    drawTL();
  }
  function pickEdge(e) { setSel({ t: 'edge', e }); const [x, y] = S.MD.edgeMid(e); map.view.cx = x; map.view.cy = y; map.view.k = Math.max(map.view.k, 0.25); map.dirty = true; setTab('station'); }
  root.prepend(h('div.sr-only', { role: 'status', 'aria-live': 'polite', id: 'cc-live-region' }));
  const ro = new ResizeObserver(() => drawTL()); ro.observe(tl);
  on('tl', drawTL);
  return { el: root, update, topics: ['result', 'live', 'view', 'actions', 'incidents', 'tl', 'crash', 'lang', 'conn', 'me'], drawTL, pickEdge };
}
