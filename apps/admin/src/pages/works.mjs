import { h, toast, ago, fmtN, fmtH } from '../vendor/ui.mjs';
import { api, list, qs, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, tabs, textarea, openDialog, confirmDialog, readFile, download, busy, mkField, fmtDT, input, errorSummary } from '../lib/kit.mjs';
import { IMPORT_SPECS, checkCsvHeader, toCsv, csvObjects } from '../lib/logic.mjs';

const istToday = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const srcBadge = (s) => h('span.badge' + (s === 'manual' ? '' : s === 'csv' ? '.info' : '.accent'), s);

export async function mount(root, ctx) {
  const host = h('div'); let active = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab') || 'works';
  const panes = { works: h('div'), incidents: h('div'), crash: h('div') }; const built = {};
  const show = (id) => { active = id; for (const [k, p] of Object.entries(panes)) p.classList.toggle('hide', k !== id); if (!built[id]) { built[id] = true; ({ works: worksPane, incidents: incidentsPane, crash: crashPane })[id](panes[id]); } };
  root.append(pageHeader('Works & incidents data', 'Road works, reported incidents and crash records. Import from CSV with a dry run first: nothing is written until you confirm.'),
    tabs([['works', 'Road works'], ['incidents', 'Incidents'], ['crash', 'Crash records']], active, show), panes.works, panes.incidents, panes.crash);
  show(active);

  /* ---------- shared import panel ---------- */
  function importPanel({ kind, title, intro, onDone }) {
    const spec = IMPORT_SPECS[kind]; const endpoint = `/admin/import/${kind}`;
    let text = '', checked = null;
    const ta = textarea({ rows: 6, placeholder: spec.header.join(','), 'aria-label': `${title} CSV text`, id: `imp-${kind}-text`, oninput: () => { text = ta.value; invalidate(); } });
    const file = h('input', { type: 'file', accept: '.csv,text/csv', id: `imp-${kind}-file`, class: 'sr', tabindex: '-1', 'aria-label': `${title} CSV file`, onchange: async () => { const f = file.files[0]; if (!f) return; text = await readFile(f); ta.value = text; fname.textContent = f.name; invalidate(); } });
    const fname = h('span.sm.muted');
    const out = h('div', { 'aria-live': 'polite' }); const status = h('span.sm.muted');
    const check = h('button.btn.primary', { id: `imp-${kind}-check`, onclick: () => doCheck() }, 'Check file (dry run)');
    const apply = h('button.btn', { id: `imp-${kind}-apply`, disabled: true, onclick: () => doApply() }, 'Import');
    function invalidate() { checked = null; apply.disabled = true; apply.textContent = 'Import'; out.replaceChildren(); }
    async function doCheck() {
      text = ta.value; const pre = checkCsvHeader(text, kind);
      const blocking = pre.filter((p) => /empty|Missing|no data/.test(p));
      if (blocking.length) { out.replaceChildren(h('div.banner.bad', { role: 'alert' }, h('div', h('b', 'Fix the file first'), h('ul.ul', { style: { color: 'inherit' } }, pre.map((p) => h('li', p)))))); return; }
      await busy(check, async () => {
        let r; try { r = await api.csv(`${endpoint}?dryRun=1`, text); } catch (e) { out.replaceChildren(h('div.banner.bad', { role: 'alert' }, errMsg(e))); return; }
        checked = r; const acc = Array.isArray(r.accepted) ? r.accepted.length : r.accepted ?? 0; const rej = r.rejected ?? [];
        out.replaceChildren(h('div.stack', { dataset: { dryrun: 'done' } },
          h('div.row', h('span.badge.good', `${fmtN(acc)} will be accepted`), h('span.badge' + (rej.length ? '.bad' : ''), `${fmtN(rej.length)} rejected`), h('span.muted.sm', 'Dry run: nothing has been saved.')),
          pre.length ? h('div.banner.info', pre.join(' ')) : null,
          rej.length ? h('div', h('div.row.between', h('h3', 'Rejected rows'), h('button.btn.sm', { onclick: () => download(`${kind}-rejected.csv`, toCsv(rej.map((x) => ({ row: x.row, reason: x.reason })), ['row', 'reason'])) }, 'Download rejected')), dataTable({ caption: 'Rejected rows', cols: [{ h: 'Row', cls: 'n', w: '70px', cell: (x) => x.row }, { h: 'Reason', cell: (x) => x.reason }], rows: rej.slice(0, 200) }).el, rej.length > 200 ? h('p.xs.faint', `Showing the first 200 of ${rej.length}.`) : null) : null,
          Array.isArray(r.acceptedRows) && r.acceptedRows.length ? h('div', h('h3', { style: { marginBottom: '6px' } }, `Accepted rows (first ${Math.min(10, r.acceptedRows.length)})`), dataTable({ caption: 'Accepted rows', cols: spec.header.filter((c) => r.acceptedRows.some((x) => x[c] != null)).map((c) => ({ h: c, cell: (x) => String(x[c] ?? '') })), rows: r.acceptedRows.slice(0, 10) }).el) : null));
        apply.disabled = acc === 0; apply.textContent = acc ? `Import ${fmtN(acc)} row${acc === 1 ? '' : 's'}` : 'Nothing to import'; if (acc) apply.classList.add('primary'); else apply.classList.remove('primary');
      });
    }
    async function doApply() {
      const acc = Array.isArray(checked.accepted) ? checked.accepted.length : checked.accepted; const rej = (checked.rejected ?? []).length;
      if (!(await confirmDialog({ title: `Import ${acc} ${kind === 'works' ? 'road works' : 'crash rows'}?`, text: `${rej ? `${rej} rejected row${rej > 1 ? 's' : ''} will be skipped. ` : ''}${kind === 'crash' ? 'Existing counts for the same station and year are replaced.' : 'Rows with the same name, road and start date update the existing work.'} The import is written to the audit log.`, ok: `Import ${acc} rows` }))) return;
      await busy(apply, async () => { try { const r = await api.csv(endpoint, text); toast(`Imported ${fmtN(Array.isArray(r.accepted) ? r.accepted.length : r.accepted)} rows${(r.rejected ?? []).length ? `, ${r.rejected.length} rejected` : ''}`, 'good'); ta.value = ''; text = ''; fname.textContent = ''; invalidate(); onDone?.(); } catch (e) { toast(errMsg(e), 'bad', 7000); } });
    }
    return h('section.card', { dataset: { import: kind } }, h('div.card-h', h('h2', title)), h('div.stack', h('p.sm.muted', intro),
      h('p.sm', 'Columns: ', h('code', spec.header.join(', ')), `. Required: ${spec.required.join(', ')}.`),
      h('div.row', h('button.btn', { type: 'button', onclick: () => file.click() }, 'Choose CSV file'), file, fname, h('button.btn.sm', { onclick: () => download(`${kind}-template.csv`, spec.example) }, 'Download template')), 
      h('div.field', h('label', { for: ta.id }, 'Or paste CSV'), ta), h('div.row', check, apply, status), out));
  }

  /* ---------- works ---------- */
  function worksPane(pane) {
    let works = [], fSrc = '', onlyActive = true;
    const tableHost = h('div'); let importHost = h('div');
    const reload = loader(tableHost, async () => { works = list(await api.get('/works'), 'works'); return tview(); });
    const exp = h('button.btn', { id: 'works-export', onclick: () => download('works.csv', toCsv(works.map((w) => ({ ...w, station: (w.stations ?? []).join(';') })), ['name', 'road', 'station', 'from', 'to', 'hours', 'cap', 'kind', 'agency', 'source', 'active'])) }, 'Export CSV');
    function tview() {
      const rows = works.filter((w) => (!fSrc || w.source === fSrc) && (!onlyActive || w.active));
      const srcSel = h('select.select.sm', { id: 'w-src', 'aria-label': 'Filter by source', onchange: () => { fSrc = srcSel.value; tableHost.replaceChildren(tview()); } }, [['', 'All sources'], 'manual', 'csv', 'connector', 'ingest'].map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v }, l); })); srcSel.value = fSrc;
      const cb = h('input', { type: 'checkbox', id: 'w-act', onchange: () => { onlyActive = cb.checked; tableHost.replaceChildren(tview()); } }); cb.checked = onlyActive;
      const t = dataTable({ caption: 'Road works', sort: { col: 3, dir: -1 }, cols: [
        { h: 'Work', sort: (w) => w.name, cell: (w) => h('span', h('b', w.name), h('span.sub', w.road)) },
        { h: 'Stations', cls: 'wrap', cell: (w) => (w.stations ?? []).join(', ') },
        { h: 'Hours', cell: (w) => w.hours },
        { h: 'From / to', sort: (w) => w.from, cell: (w) => h('span.mono.sm', `${w.from} → ${w.to}`) },
        { h: 'Capacity', cls: 'n', cell: (w) => `${Math.round(w.cap * 100)}%` },
        { h: 'Kind', cell: (w) => w.kind ?? '' }, { h: 'Source', cell: (w) => srcBadge(w.source) },
        { h: 'Status', cell: (w) => (w.active ? h('span.badge.good', 'Active') : h('span.badge', 'Inactive')) },
        { h: 'Actions', cls: 'act', cell: (w) => (w.active ? h('button.btn.sm.ghost', { 'aria-label': `Deactivate ${w.name}`, onclick: () => deactivate(w) }, 'Deactivate') : null) },
      ], rows, rowAttrs: (w) => ({ class: w.active ? '' : 'dim' }), empty: emptyState(works.length ? 'No works match' : 'No road works yet', works.length ? 'Change the filters.' : 'Import a CSV below, connect a GBA / BMRCL feed, or have commissioners add works in the Control app.') });
      return h('div', h('div.filters', h('div.field', h('label', { for: 'w-src' }, 'Source'), srcSel), h('label.row', { for: 'w-act', style: { paddingBottom: '8px' } }, cb, 'Active only'), h('span.muted.sm', { style: { paddingBottom: '8px' } }, `${rows.length} of ${works.length}`), h('div.grow'), exp), t.el);
    }
    async function deactivate(w) { if (!(await confirmDialog({ title: `Deactivate "${w.name}"?`, text: 'The work stops reducing road capacity from the next tick. The record is kept (soft delete) and shown as inactive.', ok: 'Deactivate', danger: true }))) return; try { await api.del(`/works/${encodeURIComponent(w.id)}`); toast('Work deactivated', 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad'); } }
    pane.append(h('div.stack', { style: { gap: '20px' } }, tableHost, importPanel({ kind: 'works', title: 'Import road works from CSV', intro: 'Use for GBA / BMRCL spreadsheets. Station must match a station name or alias. Dates are YYYY-MM-DD; hours is all, peak or night; cap is the fraction of capacity left (0 to 1).', onDone: reload })));
  }

  /* ---------- incidents ---------- */
  function incidentsPane(pane) {
    let date = istToday(); const tableHost = h('div');
    const d = input({ type: 'date', value: date, id: 'inc-date', onchange: () => { date = d.value; reload(); } });
    let rows = [];
    const reload = loader(tableHost, async () => {
      rows = list(await api.get('/incidents' + qs({ date })), 'incidents');
      return dataTable({ caption: 'Incidents', sort: { col: 1, dir: -1 }, cols: [
        { h: 'Id', cell: (i) => h('span.mono.sm', i.id) }, { h: 'Start', sort: (i) => i.startHour, cell: (i) => fmtH(i.startHour) + ' → ' + fmtH(i.endHour) },
        { h: 'Type', cell: (i) => i.type }, { h: 'Station', cell: (i) => i.station ?? '' }, { h: 'Edge', cls: 'n', cell: (i) => i.edge }, { h: 'Capacity', cls: 'n', cell: (i) => (i.cap != null ? Math.round(i.cap * 100) + '%' : '') },
        { h: 'Source', sort: (i) => i.src, cell: (i) => srcBadge(i.src) }, { h: 'Reported by', cell: (i) => i.by ?? i.connectorId ?? '' }], rows, empty: emptyState('No incidents on this date', 'Pick another date. Simulated incidents appear for today.') }).el;
    });
    const expActions = h('button.btn', { id: 'export-actions', onclick: (e) => busy(e.currentTarget, async () => { const b = await api.blob('/admin/export/actions.csv' + qs({ from: Date.parse(date + 'T00:00:00+05:30'), to: Date.parse(date + 'T23:59:59+05:30') })); download(`actions-${date}.csv`, b); toast('Actions CSV downloaded', 'good'); }) }, 'Export actions CSV');
    pane.append(h('div.filters', h('div.field', h('label', { for: 'inc-date' }, 'Date (IST)'), d), h('div.grow'), h('button.btn', { id: 'inc-export', onclick: () => download(`incidents-${date}.csv`, toCsv(rows, ['id', 'date', 'src', 'type', 'edge', 'station', 'startHour', 'endHour', 'cap', 'by', 'connectorId'])) }, 'Export incidents CSV'), expActions), tableHost,
      h('p.xs.faint', { style: { marginTop: '8px' } }, 'Incidents are created in the Control app, by connectors, or through /ingest/v1/events. This view is read-only; actions export covers the same date.'));
  }

  /* ---------- crash ---------- */
  function crashPane(pane) {
    const tableHost = h('div');
    let data = null;
    const reload = loader(tableHost, async () => {
      data = await api.get('/crash'); const rows = Object.entries(data.stations ?? {}).map(([n, v]) => ({ n, f: v.y2025?.fatal ?? 0, nf: v.y2025?.nonfatal ?? 0, years: Object.keys(v.hist ?? {}).length })).sort((a, b) => b.f - a.f);
      return h('div', h('div.filters', h('span.muted.sm', data.importedAt ? `Last import ${ago(data.importedAt)}` : 'Built-in seed data (2018 to 2025)'), h('div.grow'),
        h('button.btn', { id: 'crash-export', onclick: () => { const out = []; for (const [n, v] of Object.entries(data.stations)) { for (const [y, [f, nf]] of Object.entries(v.hist ?? {})) out.push({ station: n, year: y, fatal: f, nonfatal: nf }); if (v.y2025) out.push({ station: n, year: 2025, fatal: v.y2025.fatal, nonfatal: v.y2025.nonfatal }); } download('crash.csv', toCsv(out, ['station', 'year', 'fatal', 'nonfatal'])); } }, 'Export CSV')),
        dataTable({ caption: 'Crash statistics by station', cols: [{ h: 'Station', cell: (r) => h('b', r.n) }, { h: 'Fatal 2025', cls: 'n', cell: (r) => r.f }, { h: 'Non-fatal 2025', cls: 'n', cell: (r) => r.nf }, { h: 'Years of history', cls: 'n', cell: (r) => r.years }], rows, sort: { col: 1, dir: -1 } }).el);
    });
    pane.append(h('div.stack', { style: { gap: '20px' } }, importPanel({ kind: 'crash', title: 'Import crash records from CSV', intro: 'From BTP or OpenCity. Existing counts for the same station and year are replaced; other years are untouched.', onDone: reload }), tableHost));
  }
}
