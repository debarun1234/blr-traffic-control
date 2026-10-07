import { h, toast, ago } from '../vendor/ui.mjs';
import { api, list } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, statusBadge, busy, fmtMs, fmtDT } from '../lib/kit.mjs';
import { runChecks } from '../lib/actions.mjs';

const HELP = { store: 'The database answers reads and writes.', feed: 'The last tick is newer than the stale threshold.', worker: 'The worker accepted the last scheduled tick.', connectors: 'Enabled connectors ran successfully on their last attempt.', budget: 'AI and paid API usage is under the daily caps.', secrets: 'Every secretRef used by a connector resolves in Secret Manager.' };

export async function mount(root) {
  const host = h('div'); let history = [];
  const runBtn = h('button.btn.primary', { id: 'run-checks', onclick: async () => {
    await busy(runBtn, async () => { const r = await runChecks(); remember(r); const f = (r.results ?? []).filter((x) => x.status === 'fail').length; toast(f ? `Checks finished: ${f} failing` : 'Checks finished: all passing', f ? 'bad' : 'good'); reload(); });
  } }, 'Run checks now');
  root.append(pageHeader('System checks', 'Automated health checks run on a schedule. Run them now after changing a connector, secret or setting.', runBtn), host);
  const remember = (r) => { if (r?.at) { history = [{ at: r.at, results: r.results }, ...history.filter((x) => x.at !== r.at)].slice(0, 10); } };
  let latest = null;
  const reload = loader(host, async () => {
    const r = await api.get('/admin/checks'); latest = r; if (!history.length || history[0].at !== r.at) remember(r);
    const res = r.results ?? [];
    const table = dataTable({ caption: 'Latest check results', cols: [
      { h: 'Status', cell: (c) => statusBadge(c.status) },
      { h: 'Check', cell: (c) => h('span', h('b', c.name), HELP[c.id] ? h('span.sub', HELP[c.id]) : null) },
      { h: 'Detail', cls: 'wrap', cell: (c) => c.detail },
      { h: 'Duration', cls: 'n', cell: (c) => fmtMs(c.ms) },
    ], rows: res, rowAttrs: (c) => ({ dataset: { check: c.id } }), empty: emptyState('No results yet', 'Run the checks to see the first results.', h('button.btn.primary', { onclick: () => runBtn.click() }, 'Run checks now')) });
    const sum = { ok: 0, warn: 0, fail: 0 }; res.forEach((c) => sum[c.status]++);
    return h('div.stack', { style: { gap: '16px' } },
      h('div.row', h('span.muted.sm', r.at ? ['Last run ', h('b', { title: fmtDT(r.at) }, ago(r.at))] : 'Never run'), h('span.badge.good', `${sum.ok} OK`), sum.warn ? h('span.badge.warn', `${sum.warn} warning`) : null, sum.fail ? h('span.badge.bad', `${sum.fail} failing`) : null),
      table.el,
      history.length > 1 ? h('section.card', h('div.card-h', h('h2', 'Earlier results this session')), h('div.tbl-wrap', h('table.tbl.compact', h('thead', h('tr', h('th', 'Run at'), h('th', 'Result'))), h('tbody', history.slice(1).map((x) => h('tr', h('td', fmtDT(x.at)), h('td', h('span.row', (x.results ?? []).map((c) => h('span.badge' + (c.status === 'ok' ? '.good' : c.status === 'warn' ? '.warn' : '.bad'), { title: c.detail }, c.name))))))))), h('p.xs.faint', 'The API keeps only the latest result set; earlier ones are those you ran or loaded in this browser session.')) : null);
  }, { rows: 5 });
}
