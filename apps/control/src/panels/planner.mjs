// What-if closure planner: runs @blr/model in the browser (Web Worker) for 4 time windows x {close, one lane}.
import { h, fmtH } from '/vendor/ui.mjs';
import { fill } from '../util.mjs';
import { S, emit, can, scopeStations, fatal2025, setSel, setTab, lockedRegion } from '../state.mjs';
import { runAssign } from '../sim.mjs';
import { t, regionName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { sectionTitle, emptyState } from './common.mjs';

const WIN = [['peakAM', 9.0], ['mid', 13.0], ['peakPM', 18.5], ['night', 23.5]];
const PL = { st: null, road: null, res: null, busy: false, prog: 0, sel: null, err: null };
export function setPlannerTarget(si, nameIdx) { PL.st = si; PL.road = nameIdx; PL.res = null; PL.sel = null; PL.err = null; emit('planner'); }

async function run() {
  const MD = S.MD, net = MD.net, es = net.roads.get(PL.road)?.get(PL.st); if (!es || PL.busy) return;
  PL.busy = true; PL.prog = 0; PL.res = null; PL.err = null; emit('planner');
  const boost = S.live?.boost ?? 1, jobs = [];
  for (const [k, hh] of WIN) {
    jobs.push({ k: 'base' + k, h: hh, cap: null });
    for (const [o, f] of [['close', 0], ['half', 0.5]]) { const cm = new Float32Array(net.ne).fill(1); for (const e of es) cm[e] = f; jobs.push({ k: o + k, h: hh, cap: cm }); }
  }
  const out = {}; let i = 0; const closed = new Set(es);
  try {
    for (const j of jobs) { out[j.k] = await runAssign({ t: j.h, capMul: j.cap, boost, iters: 5 }); PL.prog = Math.round((++i / jobs.length) * 100); emit('plannerProg'); }
    const cells = {}; let mx = 0;
    for (const [k] of WIN) {
      const b = out['base' + k];
      for (const o of ['close', 'half']) {
        const r = out[o + k], d = r.cost - b.cost, dv = [];
        for (let e = 0; e < net.ne; e++) { const f1 = r.flow[2 * e] + r.flow[2 * e + 1], f0 = b.flow[2 * e] + b.flow[2 * e + 1]; if (f1 - f0 > 30 && !closed.has(e)) dv.push({ e, up: f1 - f0 }); }
        dv.sort((a, b2) => b2.up - a.up);
        const seen = new Set(), dd = []; for (const x of dv) { const key = net.name[x.e] + '|' + net.stn[x.e]; if (!seen.has(key) && dd.length < 8) { seen.add(key); dd.push(x); } }
        cells[o + k] = { d, div: dd }; if (d > mx) mx = d;
      }
    }
    PL.res = { cells, max: mx, road: PL.road, st: PL.st, boost, cal: S.live?.calibration ?? null }; PL.sel = 'closepeakAM';
  } catch (e) { PL.err = e; } finally { PL.busy = false; emit('planner'); }
}

export function createPlanner(map) {
  const root = h('div.cc-body'); let barEl = null, barTxt = null;
  function update() {
    const MD = S.MD, net = MD.net, mayRun = can('planner.run');
    if (PL.st == null) PL.st = S.sel ? (S.sel.t === 'st' ? S.sel.i : net.stn[S.sel.e]) : (scopeStations()[0] ?? MD.ST[0]).i;
    const roads = MD.roadsIn(PL.st); if (PL.road == null || !roads.some((r) => r[0] === PL.road)) PL.road = roads.length ? roads[0][0] : null;
    const lr = lockedRegion(), sts = MD.ST.slice().sort((a, b) => (a.n < b.n ? -1 : 1));
    const stSel = h('select.select', { id: 'pl-st', 'data-testid': 'pl-st', 'aria-label': t('col.station'), onchange: (e) => { PL.st = +e.target.value; PL.road = null; PL.res = null; PL.sel = null; update(); } },
      sts.map((s) => h('option', { value: s.i, selected: s.i === PL.st }, s.n + (lr ? '' : ` · ${regionName(s.r)}`))));
    const rdSel = h('select.select', { id: 'pl-rd', 'data-testid': 'pl-rd', 'aria-label': t('plan.road'), onchange: (e) => { PL.road = +e.target.value; PL.res = null; PL.sel = null; update(); } },
      roads.map((r) => h('option', { value: r[0], selected: r[0] === PL.road }, `${MD.NAMES[r[0]]} (${(r[1] / 1000).toFixed(1)} km)`)));
    barEl = h('i', { style: { width: PL.prog + '%' } }); barTxt = h('span.xs.faint', `${PL.prog}%`);
    const kids = [h('div.cc-sec', h('h2', t('tab.planner'))), h('p.sm.muted', t('plan.intro')),
      !mayRun ? h('div.banner.info.sm', ic('shield', 16), t('role.readonlyPlan')) : null,
      h('div.card.tight', h('div.stack', h('div.field', h('label', { for: 'pl-st' }, t('col.station')), stSel), h('div.field', h('label', { for: 'pl-rd' }, t('plan.road')), rdSel),
        h('div.row', h('button.btn.primary', { 'data-testid': 'pl-run', disabled: PL.busy || PL.road == null || !mayRun, onclick: run }, ic('play', 14), PL.busy ? t('computing') : t('plan.run')), PL.busy ? barTxt : null),
        PL.busy ? h('div.cc-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': PL.prog, 'aria-label': t('computing') }, barEl) : null))];
    if (PL.err) kids.push(h('div.banner.bad.sm', { role: 'alert' }, t('plan.failed')));
    if (PL.busy && !PL.res) kids.push(h('div.skel', { style: { height: '120px' } }));
    if (PL.res) kids.push(...result(PL.res));
    else if (!PL.busy) kids.push(emptyState(t('plan.empty'), t('plan.emptyHint')));
    const cal = S.live?.calibration;
    kids.push(h('p.xs.faint', cal && cal.rmsePct != null ? t('dq.cal', { probes: cal.probes ?? '–', rmse: cal.rmsePct.toFixed(1) }) : t('dq.uncal'), ' ', t('plan.modelNote')));
    const sc = root.scrollTop; fill(root, ...kids.filter(Boolean)); root.scrollTop = sc;
  }
  function result(R) {
    const MD = S.MD, out = [], mxv = R.max || 1;
    const head = h('tr', h('th', { scope: 'col' }, ''), ...WIN.map((w) => h('th.c', { scope: 'col' }, t(`win.${w[0]}`), h('div.faint.xs.mono', fmtH(w[1])))));
    const rows = [['close', 'plan.close'], ['half', 'plan.half']].map(([o, lab]) => h('tr', h('th', { scope: 'row' }, t(lab)), ...WIN.map(([k]) => {
      const c = R.cells[o + k], u = Math.min(1, Math.max(0, c.d) / mxv), key = o + k;
      return h('td.c', h('button.cc-cell' + (PL.sel === key ? '.on' : ''), { 'data-testid': 'cell-' + key, 'aria-pressed': String(PL.sel === key), style: { '--u': (u * 55).toFixed(0) + '%' }, onclick: () => { PL.sel = key; update(); } }, c.d < 0.5 ? '≈0' : String(Math.round(c.d))));
    })));
    out.push(sectionTitle(t('plan.added')), h('div.tbl-wrap', h('table.tbl.cc-mx', { 'data-testid': 'matrix' }, h('thead', head), h('tbody', rows))));
    const best = WIN.map((w) => [w, R.cells['close' + w[0]].d]).sort((a, b) => a[1] - b[1])[0];
    out.push(h('div.cc-advice', h('b', t('plan.advice')), ' ', t('plan.adviceText', { road: MD.NAMES[R.road], station: MD.ST[R.st].n, win: t(`win.${best[0][0]}`), best: Math.round(best[1]), peak: Math.round(R.cells.closepeakAM.d) }), ' ',
      R.cells.halfpeakAM.d < R.cells.closepeakAM.d * 0.4 ? t('plan.halfHelps') : ''));
    if (PL.sel) {
      const c = R.cells[PL.sel];
      out.push(sectionTitle(t('plan.diverted')), c.div.length ? h('div.tbl-wrap', h('table.tbl', { 'data-testid': 'divert' }, h('thead', h('tr', h('th', ''), h('th.n', '+veh/h'), h('th.n', t('kpi.fatal')))),
        h('tbody', c.div.map((d) => h('tr.click', { tabindex: 0, onclick: () => go(d.e), onkeydown: (e) => e.key === 'Enter' && go(d.e) }, h('td', MD.edgeName(d.e, t('road.unnamed')), h('div.faint.xs', MD.ST[S.MD.net.stn[d.e]].n)), h('td.n', '+' + Math.round(d.up)), h('td.n', fatal2025(S.MD.net.stn[d.e]))))))) : emptyState(t('plan.noDivert')),
      h('p.xs.faint', t('plan.fatalNote')));
    } else out.push(h('p.sm.muted', t('plan.clickCell')));
    return out;
  }
  function go(e) { setSel({ t: 'edge', e }); const [x, y] = S.MD.edgeMid(e); map.view.cx = x; map.view.cy = y; map.view.k = Math.max(map.view.k, 0.25); map.dirty = true; }
  function progress() { if (barEl) { barEl.style.width = PL.prog + '%'; barTxt.textContent = PL.prog + '%'; barEl.parentElement?.setAttribute('aria-valuenow', PL.prog); } }
  return { el: root, update, progress, topics: ['planner', 'lang', 'me', 'live'], progressTopics: ['plannerProg'] };
}
