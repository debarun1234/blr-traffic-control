// Works register: list, clash detection + quantification (in-browser model), CRUD for commissioner/admin.
import { h, toast } from '/vendor/ui.mjs';
import { S, emit, can, curHour, today } from '../state.mjs';
import { createWorks, patchWorks, deleteWorks } from '../feed.mjs';
import { clashes, clashAdvice, worksEdges, worksActiveAt } from '../analytics.mjs';
import { runAssign } from '../sim.mjs';
import { t, regionName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { reconcile, fill } from '../util.mjs';
import { openDialog, confirmDialog } from '../dialog.mjs';
import { sectionTitle, emptyState } from './common.mjs';
import { errText } from './actions.mjs';

const KINDS = ['Metro', 'Drain', 'Bridge', 'Road', 'Utility', 'Other'];
const WK = { res: {}, busy: null };

function worksForm(existing) {
  const MD = S.MD, sts = MD.ST.slice().sort((a, b) => (a.n < b.n ? -1 : 1));
  let stI = existing ? MD.stIdx.get(existing.stations?.[0]) ?? sts[0].i : sts[0].i;
  const f = {
    name: h('input.input', { type: 'text', id: 'wf-name', required: true, maxLength: 80, value: existing?.name ?? '', 'data-testid': 'wf-name', placeholder: t('wk.namePh') }),
    st: h('select.select', { id: 'wf-st', 'data-testid': 'wf-st' }, sts.map((s) => h('option', { value: s.i, selected: s.i === stI }, `${s.n} · ${regionName(s.r)}`))),
    rd: h('select.select', { id: 'wf-rd', 'data-testid': 'wf-rd' }),
    from: h('input.input', { type: 'date', id: 'wf-from', required: true, value: existing?.from ?? today() }),
    to: h('input.input', { type: 'date', id: 'wf-to', required: true, value: existing?.to ?? today() }),
    hours: h('select.select', { id: 'wf-hours' }, ['all', 'peak', 'night'].map((v) => h('option', { value: v, selected: (existing?.hours ?? 'all') === v }, t(`wk.hours.${v}`)))),
    cap: h('input.input', { type: 'number', id: 'wf-cap', min: 0, max: 100, value: Math.round((existing?.cap ?? 0.7) * 100), 'data-testid': 'wf-cap' }),
    kind: h('select.select', { id: 'wf-kind' }, KINDS.map((k) => h('option', { value: k, selected: (existing?.kind ?? 'Road') === k }, t(`wk.kind.${k}`)))),
    agency: h('input.input', { type: 'text', id: 'wf-agency', maxLength: 60, value: existing?.agency ?? '' }),
  };
  const fillRoads = () => {
    const rs = MD.roadsIn(+f.st.value, 200);
    fill(f.rd, ...rs.map((r) => h('option', { value: MD.NAMES[r[0]], selected: existing && MD.NAMES[r[0]] === existing.road }, `${MD.NAMES[r[0]]} (${(r[1] / 1000).toFixed(1)} km)`)));
    if (existing && !rs.some((r) => MD.NAMES[r[0]] === existing.road)) f.rd.prepend(h('option', { value: existing.road, selected: true }, existing.road));
  };
  f.st.addEventListener('change', fillRoads); fillRoads();
  const err = h('div.banner.bad.sm', { hidden: true, role: 'alert' });
  const submit = h('button.btn.primary', { type: 'submit', 'data-testid': 'wf-submit' }, existing ? t('save') : t('wk.add'));
  const field = (id, label, el) => h('div.field', h('label', { for: id }, label), el);
  let dlg;
  const form = h('form.cc-wform', { onsubmit: async (ev) => {
    ev.preventDefault(); err.hidden = true;
    const body = { name: f.name.value.trim().slice(0, 80), road: f.rd.value, stations: [MD.ST[+f.st.value].n], from: f.from.value, to: f.to.value, hours: f.hours.value, cap: Math.max(0, Math.min(1, (+f.cap.value || 0) / 100)), kind: f.kind.value, agency: f.agency.value.trim() || undefined };
    if (!body.name || !body.road || !body.from || !body.to) { err.textContent = t('wk.err.required'); err.hidden = false; return; }
    if (body.to < body.from) { err.textContent = t('wk.err.dates'); err.hidden = false; return; }
    submit.disabled = true;
    try { existing ? await patchWorks(existing.id, body) : await createWorks(body); toast(t(existing ? 'wk.saved' : 'wk.added'), 'good'); dlg.close(); }
    catch (e) { err.textContent = errText(e); err.hidden = false; submit.disabled = false; }
  } },
  err, field('wf-name', t('wk.name'), f.name),
  h('div.grid.g2', field('wf-st', t('col.station'), f.st), field('wf-rd', t('plan.road'), f.rd)),
  h('div.grid.g2', field('wf-from', t('wk.from'), f.from), field('wf-to', t('wk.to'), f.to)),
  h('div.grid.g3', field('wf-hours', t('wk.hours'), f.hours), field('wf-cap', t('wk.cap'), f.cap), field('wf-kind', t('wk.kind'), f.kind)),
  field('wf-agency', t('wk.agency'), f.agency), h('p.xs.faint', t('wk.capHelp')), h('div.row', { style: { justifyContent: 'flex-end', marginTop: '8px' } }, submit));
  dlg = openDialog({ title: existing ? t('wk.edit') : t('wk.add'), body: form, testid: 'works-dialog' });
}

async function quantify(c) {
  const net = S.MD.net, k = c.a.id + '+' + c.b.id; if (WK.busy) return; WK.busy = k; emitW();
  const cm = (list) => { const m = new Float32Array(net.ne).fill(1); for (const w of list) for (const e of worksEdges(net, w)) m[e] = Math.min(m[e], w.cap); return m; };
  const boost = S.live?.boost ?? 1, h0 = 9.0;
  try {
    const b0 = await runAssign({ t: h0, boost, iters: 5 }), a = await runAssign({ t: h0, capMul: cm([c.a]), boost, iters: 5 }), b = await runAssign({ t: h0, capMul: cm([c.b]), boost, iters: 5 }), ab = await runAssign({ t: h0, capMul: cm([c.a, c.b]), boost, iters: 5 });
    WK.res[k] = { A: a.cost - b0.cost, B: b.cost - b0.cost, AB: ab.cost - b0.cost };
  } catch (e) { toast(t('plan.failed'), 'bad'); }
  WK.busy = null; emitW();
}
const emitW = () => emit('works');

export function createWorksPanel() {
  const root = h('div.cc-body'), listBox = h('div.cc-workslist', { 'data-testid': 'works-list' }), clashBox = h('div.cc-clashlist'), head = h('div.cc-sec'), emptyBox = h('div');
  root.append(head, h('p.sm.muted', t('wk.intro')), listBox, emptyBox, h('div.cc-sec', h('h3', t('wk.clash')), h('span.badge', { 'data-testid': 'clash-count' }, '0')), clashBox);
  const clashHead = root.children[root.children.length - 2];
  function worksCard(w) {
    const act = worksActiveAt(w, today(), curHour()), cmd = can('works.write');
    return h('article.card.tight.cc-work', { dataset: { id: w.id } },
      h('div.row.between.nowrap', h('div.grow', h('b', w.name), h('div.xs.faint', [w.road, (w.stations ?? []).join(', '), `${w.from} → ${w.to}`, t(`wk.hours.${w.hours ?? 'all'}`)].join(' · '))), h('div.mono.cc-cap', { title: t('wk.cap') }, Math.round(w.cap * 100) + '%')),
      h('div.row', act ? h('span.badge.warn', t('wk.active')) : h('span.badge', t('wk.scheduled')), w.kind ? h('span.badge', w.kind) : null, w.agency ? h('span.badge', w.agency) : null, w.source && w.source !== 'manual' ? h('span.badge.info', t(`wk.src.${w.source}`)) : null,
        h('span.grow'), cmd ? h('button.btn.sm.ghost', { 'aria-label': t('wk.edit') + ': ' + w.name, title: t('edit'), 'data-testid': 'wk-edit', onclick: () => worksForm(w) }, ic('edit', 15)) : null,
        cmd ? h('button.btn.sm.ghost', { 'aria-label': t('remove') + ': ' + w.name, title: t('remove'), 'data-testid': 'wk-del', onclick: async () => { if (await confirmDialog(t('wk.removeQ'), w.name, t('remove'), true)) { try { await deleteWorks(w.id); toast(t('wk.removed'), 'good'); } catch (e) { toast(errText(e), 'bad'); } } } }, ic('trash', 15)) : null));
  }
  function clashCard(c) {
    const k = c.a.id + '+' + c.b.id, r = WK.res[k];
    const adv = r ? clashAdvice(c, r) : null;
    return h('article.card.cc-clash', { 'data-testid': 'clash-card' },
      h('div', h('b', c.a.name)), h('div', h('b', c.b.name)),
      h('div.xs.faint', c.kind === 'corridor' ? t('clash.corridor') : t('clash.station', { s: c.stations.join(', ') })),
      h('div.row', { style: { margin: '8px 0 0' } }, h('button.btn.sm' + (r ? '' : '.primary'), { disabled: !!WK.busy, 'data-testid': 'clash-quant', onclick: () => quantify(c) }, WK.busy === k ? t('computing') : r ? t('clash.rerun') : t('clash.quant'))),
      r ? h('table.tbl.cc-mini', h('tbody', h('tr', h('td', t('clash.alone', { w: c.a.name.split(',')[0] })), h('td.n', Math.round(r.A))), h('tr', h('td', t('clash.alone', { w: c.b.name.split(',')[0] })), h('td.n', Math.round(r.B))), h('tr', h('td', h('b', t('clash.together'))), h('td.n', h('b', { 'data-testid': 'clash-together' }, Math.round(r.AB)))))) : null,
      r ? h('div.cc-advice', h('b', t('plan.advice')), ' ', t('clash.advice', { together: Math.round(adv.together), syn: adv.synergy > 5 ? t('clash.syn', { n: Math.round(adv.synergy) }) : '', move: adv.move.name, first: adv.first.name, end: adv.first.to, solo: Math.round(adv.solo) })) : null);
  }
  function update() {
    const ws = S.works, cs = clashes(S.MD.net, ws);
    fill(head, h('div', h('h2', t('tab.works')), h('div.xs.faint', t('wk.count', { n: ws.length }))), can('works.write') ? h('button.btn.sm.primary', { 'data-testid': 'wk-add', onclick: () => worksForm(null) }, ic('plus', 14), t('wk.add')) : null);
    reconcile(listBox, ws, (w) => w.id, (w) => [w.name, w.cap, w.from, w.to, w.hours, w.kind, w.road, S.lang, can('works.write'), worksActiveAt(w, today(), curHour())].join('|'), worksCard);
    fill(emptyBox, ...(ws.length ? [] : [emptyState(t('wk.none'), can('works.write') ? t('wk.noneHint') : '')]));
    clashHead.querySelector('.badge').textContent = String(cs.length);
    reconcile(clashBox, cs, (c) => c.a.id + '+' + c.b.id, (c) => { const r = WK.res[c.a.id + '+' + c.b.id]; return [S.lang, WK.busy, r ? Math.round(r.AB) : '', c.a.name, c.b.name, c.a.to].join('|'); }, clashCard);
    if (!cs.length && !clashBox.nextSibling) clashBox.after(h('p.sm.muted.cc-noclash', t('clash.none')));
    const nc = root.querySelector('.cc-noclash'); if (nc) nc.hidden = cs.length > 0;
  }
  return { el: root, update, topics: ['works', 'lang', 'me', 'live', 'view'] };
}
