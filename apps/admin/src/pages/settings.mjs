import { h, toast } from '../vendor/ui.mjs';
import { list } from '../lib/api.mjs';
import { pageHeader, loader, mkField, input, select, toggle, errorSummary, validateFields, showSummary, serverError, openDialog, clearSummary } from '../lib/kit.mjs';
import { getSettings, putSettings } from '../lib/actions.mjs';
import { diffObjects, validateSettings, FEED_MODES } from '../lib/logic.mjs';

const MODE_HELP = { sim: 'Simulator only. Every number is modelled; connectors are not used for state.', live: 'The model is calibrated against live probe observations. Still modelled: only the probed corridors are measured.', blend: 'Live where probes are fresh, simulator elsewhere. Falls back automatically when a feed goes stale.' };
const LABELS = { 'feed.mode': 'Feed mode', 'feed.tickMin': 'Tick interval (min)', 'feed.staleAfterMin': 'Stale after (min)', 'workflow.escalateAfterMin': 'Escalate after (min)', 'workflow.verifyAfterMin': 'Verify after (min)', 'caps.routesCallsPerDay': 'Google Routes calls / day', 'caps.tomtomCallsPerDay': 'TomTom calls / day', maintenance: 'Maintenance mode' };

export async function mount(root, ctx) {
  const host = h('div');
  root.append(pageHeader('Settings', 'Platform-wide behaviour. Changes apply on the next tick. You will see a diff and confirm before anything is saved.'), host);
  const reload = loader(host, async () => {
    let cur = await getSettings(); const summary = errorSummary(); const fields = {};
    const num = (path, label, o = {}) => { const v = path.split('.').reduce((a, k) => a?.[k], cur); const el = input({ type: 'number', inputmode: 'numeric', value: String(v ?? ''), step: '1', ...o.attrs }); fields[path] = mkField(label, el, { hint: o.hint, required: true, validate: () => collect().errors[path] ?? null }); return fields[path]; };
    const mode = select(FEED_MODES.map((m) => [m, m]), cur.feed.mode); const modeHelp = h('p.hint', { 'aria-live': 'polite' }, MODE_HELP[cur.feed.mode]);
    mode.addEventListener('change', () => { modeHelp.textContent = MODE_HELP[mode.value]; });
    fields['feed.mode'] = mkField('Feed mode', mode, { required: true, validate: () => collect().errors['feed.mode'] ?? null });
    const maint = toggle(cur.maintenance, 'Maintenance mode');
    const maintRow = h('div.row.nowrap', maint, h('div', h('b', 'Maintenance mode'), h('div.hint', 'Pauses the feed and shows users a notice. Use before risky changes.')));
    const grid = (...f) => h('div.fgrid', ...f);
    const collect = () => {
      const val = (p) => { const e = fields[p]?.ctl; return e ? (e.value === '' ? NaN : Number(e.value)) : undefined; };
      const next = structuredClone(cur);
      next.feed.mode = mode.value; next.feed.tickMin = val('feed.tickMin'); next.feed.staleAfterMin = val('feed.staleAfterMin');
      next.workflow.escalateAfterMin = val('workflow.escalateAfterMin'); next.workflow.verifyAfterMin = val('workflow.verifyAfterMin');
      next.caps.routesCallsPerDay = val('caps.routesCallsPerDay'); next.caps.tomtomCallsPerDay = val('caps.tomtomCallsPerDay'); next.maintenance = maint.input.checked;
      return { next, errors: validateSettings(next) };
    };
    const sections = h('div.stack', { style: { gap: '16px' } },
      h('section.card', h('div.card-h', h('h2', 'Data feed')), h('div.stack', h('div.fgrid', fields['feed.mode']), modeHelp, grid(num('feed.tickMin', 'Tick interval (minutes)', { hint: 'How often the worker rebuilds state. 1 to 60.' }), num('feed.staleAfterMin', 'Stale after (minutes)', { hint: 'No tick for this long marks the feed stale. At least twice the tick interval.' })))),
      h('section.card', h('div.card-h', h('h2', 'Action workflow')), grid(num('workflow.escalateAfterMin', 'Escalate after (minutes)', { hint: 'An action nobody acknowledged is escalated to the next level after this long.' }), num('workflow.verifyAfterMin', 'Verify after (minutes)', { hint: 'After an action is done, congestion is re-checked this long afterwards.' }))),
      h('section.card', h('div.card-h', h('h2', 'Paid API caps')), grid(num('caps.routesCallsPerDay', 'Google Routes calls per day'), num('caps.tomtomCallsPerDay', 'TomTom calls per day')), h('p.hint', { style: { marginTop: '8px' } }, 'Hard stop across all connectors of that type. Per-connector caps are set on each connector.')),
      h('section.card', h('div.card-h', h('h2', 'Maintenance')), maintRow),
      h('section.card.flat', h('div.card-h', h('h2', 'AI')), h('p.sm.muted', `AI is ${cur.ai?.enabled ? 'on' : 'off'}; daily cap ${cur.ai?.dailyCallCap ?? '-'} calls. Limits, tiers and the kill switch live on the `, h('a', { href: '#/ai' }, 'AI & cost'), ' page.')));
    const save = h('button.btn.primary', { id: 'settings-save', type: 'submit' }, 'Review changes');
    const revert = h('button.btn', { type: 'button', onclick: () => reload() }, 'Discard edits');
    const form = h('form.stack', { novalidate: true, onsubmit: (e) => { e.preventDefault(); review(); } }, summary, sections, h('div.row', save, revert, h('span.faint.sm', 'Saving shows a diff first.')));
    function review() {
      const { next, errors } = collect();
      const bad = Object.values(fields).filter((f) => { const m = errors[Object.keys(fields).find((k) => fields[k] === f)]; f.setError(m ?? null); return !!m; });
      if (bad.length) { showSummary(summary, `${bad.length} setting${bad.length > 1 ? 's' : ''} invalid`, bad.map((f) => ({ text: `${f.fieldLabel}: ${f.dataset.err}`, focus: f.ctl }))); bad[0].ctl.focus(); return; }
      clearSummary(summary);
      const diff = diffObjects(cur, next);
      if (!diff.length) return toast('No changes to save');
      const warn = []; if (next.maintenance && !cur.maintenance) warn.push('Maintenance on pauses the feed for all users.'); if (next.feed.mode !== cur.feed.mode) warn.push(`Feed mode changes from ${cur.feed.mode} to ${next.feed.mode}: displayed numbers will change on the next tick.`);
      const dlgSummary = errorSummary();
      openDialog({ title: `Save ${diff.length} change${diff.length > 1 ? 's' : ''}?`, size: 'lg', content: h('div.stack', dlgSummary, warn.length ? h('div.banner', h('ul.ul', { style: { margin: 0, color: 'inherit' } }, warn.map((w) => h('li', w)))) : null,
        h('div.tbl-wrap', h('table.tbl.diff.compact', h('thead', h('tr', h('th', 'Setting'), h('th', 'Current'), h('th', 'New'))), h('tbody', diff.map((d) => h('tr', h('td', LABELS[d.path] ?? d.path), h('td', String(d.from)), h('td', String(d.to)))))))),
        actions: [{ label: 'Back to editing', value: false }, { label: 'Confirm and save', kind: 'primary', value: true, attrs: { id: 'settings-confirm' }, onClick: async () => {
          try { cur = (await putSettings(next)) ?? next; } catch (e) { serverError(dlgSummary, e); return false; }
          ctx.setMaintenance(!!next.maintenance); toast('Settings saved', 'good'); reload();
        } }] });
    }
    return form;
  });
}
