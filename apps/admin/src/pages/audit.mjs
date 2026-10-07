import { h, toast } from '../vendor/ui.mjs';
import { api, list, qs, errMsg } from '../lib/api.mjs';
import { pageHeader, emptyState, errorState, skeleton, input, h as _h, fmtDT, download, busy, uid } from '../lib/kit.mjs';
import { dateInputToMs } from '../lib/logic.mjs';

const KINDS = ['user.create', 'user.update', 'user.deactivate', 'connector.create', 'connector.update', 'connector.delete', 'connector.run', 'connector.test', 'probe.create', 'probe.update', 'probe.delete', 'apikey.create', 'apikey.revoke', 'settings.update', 'ai.limits', 'ai.kill', 'budget_kill', 'station.update', 'territories.put', 'territories.delete', 'import.works', 'import.crash', 'checks.run', 'action.transition', 'works.write', 'incident.report'];
const PAGE = 50;

export async function mount(root) {
  const f = {};
  const mk = (id, label, el, cls = '') => { el.id = id; return h('div.field' + cls, h('label', { for: id }, label), el); };
  const actor = input({ placeholder: 'email contains', type: 'search' });
  const kind = input({ placeholder: 'e.g. user.update', list: 'kinds' });
  const from = input({ type: 'date' }), to = input({ type: 'date' });
  const apply = h('button.btn.primary', { type: 'submit' }, 'Apply');
  const exp = h('button.btn', { type: 'button', id: 'audit-export', onclick: () => busy(exp, async () => { const b = await api.blob('/admin/audit.csv' + qs({ ...params(), limit: undefined })); download(`audit-${new Date().toISOString().slice(0, 10)}.csv`, b); toast('Audit CSV downloaded', 'good'); }) }, 'Export CSV');
  const reset = h('button.btn.ghost', { type: 'button', onclick: () => { actor.value = kind.value = from.value = to.value = ''; run(); } }, 'Clear');
  const form = h('form.filters', { novalidate: true, onsubmit: (e) => { e.preventDefault(); run(); } }, mk('au-actor', 'Actor', actor), mk('au-kind', 'Kind', kind), mk('au-from', 'From (IST)', from), mk('au-to', 'To (IST)', to), h('div.row', { style: { paddingBottom: '1px' } }, apply, reset, exp), h('datalist', { id: 'kinds' }, KINDS.map((k) => h('option', { value: k }))));
  const out = h('div'); const more = h('div', { style: { textAlign: 'center', marginTop: '12px' } });
  root.append(pageHeader('Audit log', 'Append-only record of every change made through this site and the API. Rows are never edited or deleted by the app.'), form, out, more);
  let rows = [], next = null, tbody, status;
  const params = () => ({ actor: actor.value.trim().toLowerCase(), kind: kind.value.trim(), from: dateInputToMs(from.value), to: dateInputToMs(to.value, true) });

  async function run() {
    rows = []; next = null; out.replaceChildren(skeleton(8)); more.replaceChildren();
    try { await fetchPage(); } catch (e) { out.replaceChildren(errorState(e, run)); }
  }
  async function fetchPage() {
    const r = await api.get('/admin/audit' + qs({ ...params(), limit: PAGE, before: next }));
    const got = list(r, ['audit', 'entries', 'rows']); rows = rows.concat(got);
    next = r.next ?? (got.length === PAGE ? got.at(-1).at : null);
    render();
  }
  function render() {
    if (!rows.length) { out.replaceChildren(emptyState('No audit entries match', 'Widen the date range or clear the filters.', h('button.btn', { onclick: () => reset.click() }, 'Clear filters'))); more.replaceChildren(); return; }
    tbody = h('tbody', rows.map(row));
    out.replaceChildren(h('div.tbl-wrap', h('table.tbl.mono-rows', h('caption.sr', 'Audit log'), h('thead', h('tr', ['Time (IST)', 'Actor', 'Kind', 'Target', 'Summary', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
    status = h('p.xs.faint', { role: 'status' }, `${rows.length} entries shown${next ? '' : ' (end of log)'}`);
    more.replaceChildren(status, next ? h('button.btn', { id: 'audit-more', onclick: (e) => busy(e.currentTarget, async () => { await fetchPage(); }) }, 'Load older entries') : null);
  }
  function row(a) {
    const hasMeta = a.meta && Object.keys(a.meta).length; const id = uid('meta');
    const tr = h('tr', { dataset: { kind: a.kind } }, h('td', { style: { whiteSpace: 'nowrap' } }, fmtDT(a.at)), h('td', a.actor, h('span.sub', a.role)), h('td', h('span.badge', a.kind)), h('td', { style: { wordBreak: 'break-all' } }, a.target ?? ''), h('td.wrap', { style: { fontFamily: 'var(--font)', fontSize: '12.5px' } }, a.summary, hasMeta ? h('div', { id, class: 'hide' }, h('pre.code', { style: { marginTop: '6px' } }, JSON.stringify(a.meta, null, 2))) : null, a.ip ? h('span.sub', a.ip) : null),
      h('td', hasMeta ? h('button.btn.ghost.sm', { 'aria-expanded': 'false', 'aria-controls': id, onclick: (e) => { const b = e.currentTarget, el = document.getElementById(id), open = b.getAttribute('aria-expanded') === 'true'; b.setAttribute('aria-expanded', String(!open)); b.textContent = open ? 'Details' : 'Hide'; el.classList.toggle('hide', open); } }, 'Details') : null));
    return tr;
  }
  run();
}
