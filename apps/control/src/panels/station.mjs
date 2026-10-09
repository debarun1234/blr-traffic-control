// Station / road detail: KPIs, crash sparklines, selected road, incident reporting, station actions.
import { h, toast } from '/vendor/ui.mjs';
import { INCIDENT_TYPES } from '/vendor/model.mjs';
import { S, on, can, canActOn, setSel, setTab, scopeStations, fatal2025, nonfatal2025, hasCrash, crashHist, incidentsAt, curHour, myStation, openActions } from '../state.mjs';
import { reportIncident } from '../feed.mjs';
import { topRoads, colourClass, CLASS_NAMES } from '../analytics.mjs';
import { t, regionName, typeName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { svg, clear, fill } from '../util.mjs';
import { kpi, sectionTitle, emptyState, speedTag } from './common.mjs';
import { actionCard } from './actions.mjs';
import { errText } from './actions.mjs';
import { setPlannerTarget } from './planner.mjs';

function spark(values, years, color) {
  const w = 300, hh = 34, mx = Math.max(...values, 1), bw = (w - 10) / values.length;
  const s = svg('svg', { viewBox: `0 0 ${w} ${hh + 24}`, width: '100%', role: 'img', 'aria-label': values.map((v, i) => `${years[i]}: ${v}`).join(', ') });
  values.forEach((v, i) => {
    const bh = (v / mx) * hh, x = 5 + i * bw;
    s.append(svg('rect', { x: x + 3, y: hh + 10 - bh, width: bw - 6, height: Math.max(bh, 1), rx: 2, style: `fill:${color};opacity:.9` }),
      svg('text', { x: x + bw / 2, y: hh + 7 - bh, 'font-size': 9.5, 'text-anchor': 'middle', style: 'fill:var(--ink)' }, v),
      svg('text', { x: x + bw / 2, y: hh + 22, 'font-size': 9, 'text-anchor': 'middle', style: 'fill:var(--ink-2)' }, years[i]));
  });
  return s;
}

let repEdge = null, repForm = null;
function buildReportForm(e, done) {
  const type = h('select.select', { id: 'rep-type', 'aria-label': t('rep.type') }, INCIDENT_TYPES.map((x) => h('option', { value: x.type }, typeName(x.type))));
  const dur = h('input.input', { type: 'number', id: 'rep-dur', min: 10, max: 240, value: 40, 'aria-label': t('rep.dur') });
  const note = h('input.input', { type: 'text', id: 'rep-note', maxLength: 200, placeholder: t('rep.note'), 'aria-label': t('rep.note') });
  const submit = h('button.btn.sm.primary', { type: 'submit', 'data-testid': 'rep-submit' }, t('rep.submit'));
  const form = h('form.cc-form', { onsubmit: async (ev) => {
    ev.preventDefault(); const durationMin = Math.max(10, Math.min(240, Math.round(+dur.value || 40)));
    submit.disabled = true;
    try { await reportIncident({ edge: e, type: type.value, durationMin, note: note.value.trim() || undefined }); toast(t('rep.ok'), 'good'); done(); }
    catch (err) { toast(errText(err), 'bad'); submit.disabled = false; }
  } },
  h('div.field', h('label', { for: 'rep-type' }, t('rep.type')), type), h('div.field', h('label', { for: 'rep-dur' }, t('rep.dur')), dur), h('div.field', h('label', { for: 'rep-note' }, t('rep.note')), note),
  h('div.row', submit, h('button.btn.sm.ghost', { type: 'button', onclick: done }, t('cancel'))));
  return form;
}

export function createStation(map) {
  const root = h('div.cc-body');
  function update() {
    const MD = S.MD, net = MD.net, res = S.result, sel = S.sel, e = sel?.t === 'edge' ? sel.e : -1, si = sel ? (sel.t === 'st' ? sel.i : net.stn[sel.e]) : -1;
    const kids = [];
    if (si < 0) {
      kids.push(h('p.sm.muted', t('stn.hint')), sectionTitle(t('stn.rank')));
      kids.push(h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', t('col.station')), h('th', t('col.region')), h('th.n', t('col.fatal')))),
        h('tbody', scopeStations().sort((a, b) => fatal2025(b.i) - fatal2025(a.i)).slice(0, 12).map((s) => h('tr.click', { tabindex: 0, onclick: () => pick(s.i), onkeydown: (ev) => ev.key === 'Enter' && pick(s.i) }, h('td', s.n), h('td', regionName(s.r)), h('td.n', fatal2025(s.i))))))));
      return void fill(root, ...kids);
    }
    const s = MD.ST[si], p = S.sum?.per[si], lv = !S.replay && S.live?.stations?.[si], spd = lv ? lv.speed : p?.speed, cong = lv ? lv.cong : p?.congPct;
    const rank = hasCrash(si) ? MD.ST.filter((x) => hasCrash(x.i)).sort((a, b) => fatal2025(b.i) - fatal2025(a.i)).findIndex((x) => x.i === si) + 1 : 0;
    kids.push(h('div.cc-sec.cc-head', h('div', h('h2', { 'data-testid': 'stn-name' }, s.n), h('div.row', { style: { marginTop: '4px' } }, h('span.badge', regionName(s.r)), s.sub && s.sub !== s.r ? h('span.badge', s.sub) : null, myStation() === si ? h('span.badge.accent', t('badge.mine')) : null)),
      h('button.btn.sm.ghost', { onclick: () => setSel(null), 'aria-label': t('stn.clear') }, ic('x', 16))));
    if (e >= 0) {
      const inc = incidentsAt(curHour()).find((x) => x.e === e), mayReport = can('incident.report') && canActOn(si) && S.replay == null;
      if (repEdge !== e) { repEdge = null; repForm = null; }
      const rd = net.name[e];
      kids.push(sectionTitle(t('stn.road')), h('div.card.tight.cc-road', { 'data-testid': 'road-card' },
        h('div.row.between.nowrap', h('b', MD.edgeName(e, t('road.unnamed'))), h('span.badge', t(`cls.${CLASS_NAMES[net.cls[e]]}`))),
        h('div.row.sm.mono.muted', res ? [h('span', `${Math.round(res.spd[e])} km/h`), h('span', `v/c ${res.vc[e].toFixed(2)}`)] : h('span.skel', { style: { width: '120px' } }), h('span', `${Math.round(net.len[e])} m`), inc ? h('span.badge.bad', typeName(inc.type)) : null),
        h('div.row', { style: { marginTop: '8px' } },
          h('button.btn.sm', { 'data-testid': 'plan-here', onclick: () => { setPlannerTarget(net.stn[e], rd); setTab('planner'); } }, ic('route', 14), t('stn.plan')),
          mayReport ? h('button.btn.sm', { 'data-testid': 'rep-open', 'aria-expanded': String(repEdge === e), onclick: () => { if (repEdge === e) { repEdge = null; repForm = null; } else { repEdge = e; repForm = buildReportForm(e, () => { repEdge = null; repForm = null; update(); }); } update(); } }, ic('alert', 14), t('rep.open')) : null),
        repEdge === e && repForm ? repForm : null));
    }
    kids.push(h('div.cc-kpis', kpi(t('kpi.fatal'), hasCrash(si) ? String(fatal2025(si)) : '–'), kpi(t('kpi.nonfatal'), hasCrash(si) ? String(nonfatal2025(si)) : '–'), kpi(t('kpi.rank'), rank ? `#${rank}` : '–', { sub: `/ ${MD.ST.filter((x) => hasCrash(x.i)).length}` }),
      kpi(t('kpi.speed'), spd != null ? h('span', Math.round(spd), h('small', ' km/h')) : '–'), kpi(t('kpi.cong'), cong != null ? h('span', Math.round(cong), h('small', '%')) : '–'), kpi(t('kpi.inc'), String(incidentsAt(curHour()).filter((x) => x.stn === si).length))));
    const hs = crashHist(si);
    if (hs) {
      const yrs = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
      kids.push(sectionTitle(t('stn.trend')), h('div.card.tight', h('div.xs.muted', t('stn.fatalOnly')), spark(yrs.map((y) => hs[y]?.[0] ?? 0), yrs, 'var(--bad)'), h('div.xs.muted', t('stn.allCrashes')), spark(yrs.map((y) => (hs[y]?.[0] ?? 0) + (hs[y]?.[1] ?? 0)), yrs, 'var(--accent)')));
    } else kids.push(h('p.sm.muted', t(S.crash ? 'stn.noHist' : 'loading')));
    const acts = openActions().filter((a) => a.stn === si);
    if (acts.length) kids.push(sectionTitle(t('tab.actions')), ...acts.map(actionCard));
    kids.push(sectionTitle(t('sec.topRoads')));
    if (res) {
      const list = topRoads(net, res.vc, res.spd, { stn: si, n: 6 });
      kids.push(list.length ? h('div.cc-list', list.map((o) => h('button.cc-li', { onclick: () => map && (setSel({ t: 'edge', e: o.e })) }, h('span.grow', h('span.cc-li-t', MD.NAMES[o.nameIdx])), speedTag(o.speed, colourClass(o.vc))))) : emptyState(t('empty.roads')));
    } else kids.push(h('div.skel', { style: { height: '90px' } }));
    kids.push(h('div.row', { style: { marginTop: '4px' } }, h('button.btn.sm', { onclick: () => map.fitBox(s.box, 0.25) }, t('stn.zoom')), h('button.btn.sm', { onclick: () => { setPlannerTarget(si, null); setTab('planner'); } }, t('tab.planner'))));
    if (!canActOn(si) && S.me?.role !== 'viewer') kids.push(h('p.sm.muted', t('stn.outside')));
    const sc = root.scrollTop; fill(root, ...kids); root.scrollTop = sc;
  }
  function pick(i) { setSel({ t: 'st', i }); map.fitBox(S.MD.ST[i].box, 0.25); }
  return { el: root, update, topics: ['sel', 'result', 'actions', 'crash', 'lang', 'me', 'incidents', 'live'] };
}
