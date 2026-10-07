import { h, toast, ago, fmtN } from '../vendor/ui.mjs';
import { cfg, api, list, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, mkField, input, select, toggle, errorSummary, showSummary, clearSummary, serverError, openDialog, confirmDialog, codeBlock, busy, fmtMs, fmtDT } from '../lib/kit.mjs';
import { CONNECTOR_TYPES, TYPE_ORDER, MAPPINGS, validateConnectorForm } from '../lib/connector-types.mjs';
import { validateSecretRef, istDayStartMs } from '../lib/logic.mjs';
import { guideFor } from '../lib/guides.mjs';

const originOf = () => new URL(cfg.apiBase, location.href).origin;

export async function mount(root, ctx) {
  let conns = [], probes = [];
  const host = h('div'); const usage = new Map();
  root.append(pageHeader('Connectors', 'Where data comes from. Each connector pulls from or receives from an existing system (ASTraM, ANPR, BATCS exports, GBA / BMRCL works, speed APIs, BTP crash records). Secrets are never entered here: you give the name of a Secret Manager secret.',
    h('button.btn.primary', { id: 'add-connector', onclick: () => editDialog() }, '+ Add connector')), host);

  const reload = loader(host, async () => {
    [conns, probes] = await Promise.all([api.get('/admin/connectors').then((r) => list(r, 'connectors')), api.get('/admin/probes').then((r) => list(r, 'probes')).catch(() => [])]);
    queueMicrotask(loadUsage);
    return view();
  });

  function statusOf(c) { return !c.enabled ? ['', 'Disabled'] : !c.lastRun ? ['', 'Never run'] : c.lastRun.ok ? ['good', 'Healthy'] : ['bad', 'Failing']; }
  function view() {
    const table = dataTable({ caption: 'Connectors', cols: [
      { h: 'Connector', minw: '230px', cell: (c) => h('span', h('b', c.name), h('span.sub', `${CONNECTOR_TYPES[c.type]?.label ?? c.type} · every ${c.intervalMin} min`)) },
      { h: 'Status', cell: (c) => { const [k, l] = statusOf(c); return h('span', h('span.row.nowrap', h('span.badge' + (k ? '.' + k : ''), h('span.dot' + (k ? '.' + k : '')), l), c.mode === 'shadow' ? h('span.badge.info', { title: 'Data is recorded but not applied to the live state' }, 'shadow') : null), c.enabled && c.lastRun && !c.lastRun.ok ? h('span.sub.bad', { style: { whiteSpace: 'normal', maxWidth: '230px' } }, c.lastRun.error) : null); } },
      { h: 'Last run', cell: (c) => (c.lastRun ? h('span', { title: fmtDT(c.lastRun.at) }, ago(c.lastRun.at), h('span.sub', `${fmtN(c.lastRun.count)} records · ${fmtMs(c.lastRun.ms)}`)) : h('span.faint', '-')) },
      { h: 'Daily cap', cell: (c) => (c.dailyCap ? h('span', { dataset: { capfor: c.id }, style: { display: 'block', minWidth: '90px' } }, h('span.mono.sm', { class: 'capn' }, `- / ${fmtN(c.dailyCap)}`), h('div.meter', { style: { marginTop: '3px' } }, h('i', { style: { width: '0%' } }))) : h('span.faint', 'none')) },
      { h: 'On', cell: (c) => { const t = toggle(c.enabled, `${c.enabled ? 'Disable' : 'Enable'} ${c.name}`, { onchange: () => setEnabled(c, t.input) }); return t; } },
      { h: 'Actions', cls: 'act', cell: (c) => h('span.row.nowrap', { style: { justifyContent: 'flex-end' } },
        h('button.btn.sm', { 'aria-label': `Test ${c.name}`, onclick: (e) => testIt(c, e.currentTarget) }, 'Test'),
        h('button.btn.sm', { 'aria-label': `Run ${c.name} now`, onclick: (e) => runNow(c, e.currentTarget) }, 'Run now'),
        h('button.btn.sm.ghost', { 'aria-label': `History of ${c.name}`, onclick: () => history(c) }, 'History'),
        h('button.btn.sm.ghost', { 'aria-label': `Edit ${c.name}`, onclick: () => editDialog(c) }, 'Edit'),
        h('button.btn.sm.ghost', { 'aria-label': `Delete ${c.name}`, onclick: () => del(c) }, 'Delete')) },
    ], rows: conns, rowAttrs: (c) => ({ class: c.enabled ? '' : 'dim', dataset: { connector: c.name } }),
    empty: emptyState('No connectors yet', 'Add the built-in simulator first so the map always has data, then connect real systems from the catalogue below.', h('button.btn.primary', { onclick: () => editDialog() }, '+ Add connector')) });
    return h('div.stack', { style: { gap: '20px' } },
      h('div.banner.info', h('span', h('b', 'Shadow mode. '), 'A connector in shadow mode runs and records what it would have contributed (visible in run history and Test), but nothing is applied to the live state. Use it to prove a new feed before trusting it, then switch it to live.')),
      table.el,
      h('section', h('div.card-h', h('h2', 'Catalogue: what you can connect')), h('div.catalog', TYPE_ORDER.map((t) => { const T = CONNECTOR_TYPES[t]; return h('div.card.tight', { dataset: { type: t } }, h('div.row.between', h('b', T.label), T.paid ? h('span.badge.warn', 'paid') : null), h('p', T.blurb), h('div.xs.faint', 'Needs: ' + T.needs.join('; ')), h('div.row', h('button.btn.sm', { onclick: () => editDialog(null, t) }, 'Add'), h('button.btn.sm.ghost', { onclick: () => guide(t) }, 'Integration guide'))); }))));
  }
  async function loadUsage() {
    const start = istDayStartMs();
    for (const c of conns.filter((x) => x.dailyCap)) {
      try { const runs = list(await api.get(`/admin/connectors/${encodeURIComponent(c.id)}/runs?limit=200`), 'runs'); const used = runs.filter((r) => r.at >= start).reduce((a, r) => a + (r.cost?.calls ?? 0), 0);
        const cell = host.querySelector(`[data-capfor="${CSS.escape(c.id)}"]`); if (!cell) continue; const pct = used / c.dailyCap;
        cell.querySelector('.capn').textContent = `${fmtN(used)} / ${fmtN(c.dailyCap)}`; const m = cell.querySelector('.meter'); m.className = 'meter' + (pct >= 1 ? ' bad' : pct >= .8 ? ' warn' : ''); m.firstChild.style.width = Math.min(100, pct * 100) + '%';
      } catch {}
    }
  }

  async function setEnabled(c, cb) {
    try { await api.patch(`/admin/connectors/${encodeURIComponent(c.id)}`, { enabled: cb.checked }); toast(`${c.name} ${cb.checked ? 'enabled' : 'disabled'}`, 'good'); reload(); }
    catch (e) { cb.checked = !cb.checked; toast(errMsg(e), 'bad', 6000); }
  }
  async function runNow(c, btn) {
    await busy(btn, async () => { const r = await api.post(`/admin/connectors/${encodeURIComponent(c.id)}/run`, {}); const ok = r.ok !== false && !r.error; toast(ok ? `${c.name}: ${fmtN(r.count ?? 0)} records in ${fmtMs(r.ms)}${c.mode === 'shadow' ? ' (shadow: not applied)' : ''}` : `${c.name} failed: ${r.error}`, ok ? 'good' : 'bad', 6000); reload(); });
  }
  async function testIt(c, btn) {
    await busy(btn, async () => {
      const r = await api.post(`/admin/connectors/${encodeURIComponent(c.id)}/test`, {});
      const sample = JSON.stringify(r.sample ?? null, null, 2);
      openDialog({ title: `Test: ${c.name}`, size: 'lg', content: h('div.stack', { dataset: { testresult: r.ok ? 'ok' : 'fail' } },
        h('div.row', h('span.badge' + (r.ok ? '.good' : '.bad'), r.ok ? 'Reachable and parseable' : 'Failed'), h('span.badge', `${fmtMs(r.ms)}`), h('span.muted.sm', 'Dry run: nothing was written to the live state.')),
        r.error ? h('div.banner.bad', r.error) : null,
        r.sample != null ? h('div', h('h3', { style: { marginBottom: '6px' } }, `Sample (${Array.isArray(r.sample) ? r.sample.length + ' of the first rows' : 'response'})`), codeBlock(sample.length > 4000 ? sample.slice(0, 4000) + '\n…' : sample, 'Copy')) : null),
        actions: [{ label: 'Close', kind: 'primary', value: true }] });
    });
  }
  async function del(c) {
    if (!(await confirmDialog({ title: `Delete "${c.name}"?`, text: 'The connector stops immediately and its configuration is removed. Run history is kept for 14 days. Data it already imported stays. This cannot be undone.', ok: 'Delete connector', danger: true }))) return;
    try { await api.del(`/admin/connectors/${encodeURIComponent(c.id)}`); toast(`Deleted ${c.name}`, 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad', 6000); }
  }
  async function history(c) {
    const body = h('div', h('div.skel', { style: { height: '120px' } }));
    openDialog({ title: `Run history: ${c.name}`, drawer: true, content: body, actions: [{ label: 'Close', value: true }] });
    try {
      const runs = list(await api.get(`/admin/connectors/${encodeURIComponent(c.id)}/runs?limit=50`), 'runs');
      body.replaceChildren(runs.length ? dataTable({ caption: 'Runs', cols: [{ h: 'When', cell: (r) => h('span', { title: fmtDT(r.at) }, ago(r.at)) }, { h: 'Result', cell: (r) => h('span.badge' + (r.ok ? '.good' : '.bad'), r.ok ? 'OK' : 'Failed') }, { h: 'Records', cls: 'n', cell: (r) => fmtN(r.count) }, { h: 'Time', cls: 'n', cell: (r) => fmtMs(r.ms) }, { h: 'Calls', cls: 'n', cell: (r) => r.cost?.calls ?? '-' }, { h: 'Error', cls: 'wrap', cell: (r) => r.error ?? '' }], rows: runs }).el : emptyState('No runs yet', 'Use Run now to try it.'));
    } catch (e) { body.replaceChildren(h('p.bad', errMsg(e))); }
  }
  function guide(type) {
    const secs = guideFor(type, originOf());
    openDialog({ title: `Integration guide: ${CONNECTOR_TYPES[type].label}`, drawer: true, content: h('div.stack', { style: { gap: '18px' } }, h('p.muted', CONNECTOR_TYPES[type].blurb),
      secs.map((s) => h('section.stack', { style: { gap: '8px' } }, h('h3', s.h), s.p ? h('p.sm', s.p) : null, s.list ? h('ul.ul', s.list.map((x) => h('li', x))) : null, s.code ? codeBlock(s.code) : null, s.after ? h('p.sm.muted', s.after) : null)),
      h('p.xs.faint', 'Keys shown are placeholders ($BLR_API_KEY). Create real keys on the API keys page; they are shown once.')), actions: [{ label: 'Close', value: true }] });
  }

  /* ---------- create / edit ---------- */
  function editDialog(c, presetType) {
    const edit = !!c; let type = c?.type ?? presetType ?? 'rest';
    const summary = errorSummary();
    const typeSel = select(TYPE_ORDER.map((t) => [t, CONNECTOR_TYPES[t].label]), type, { disabled: edit });
    const typeInfo = h('div.card.flat.tight', { 'aria-live': 'polite' });
    const name = input({ value: c?.name ?? '', placeholder: 'e.g. ASTraM incidents' });
    const interval = input({ type: 'number', value: String(c?.intervalMin ?? 10), min: '1', max: '1440' });
    const mode = select([['shadow', 'Shadow: record, do not apply'], ['live', 'Live: apply to state']], c?.mode ?? 'shadow');
    const enabled = toggle(c?.enabled ?? true, 'Enabled');
    const secret = input({ value: c?.secretRef ?? '', placeholder: 'secret-name', autocapitalize: 'off' });
    const cap = input({ type: 'number', value: c?.dailyCap != null ? String(c.dailyCap) : '', min: '1', placeholder: 'no cap' });
    const common = {
      name: mkField('Name', name, { required: true, validate: () => err('name') }),
      intervalMin: mkField('Run every (minutes)', interval, { required: true, validate: () => err('intervalMin') }),
      mode: mkField('Mode', mode, { hint: 'Start new feeds in shadow mode. Switch to live once the sample and run history look right.' }),
      secretRef: mkField('Secret name (secretRef)', secret, { hint: 'The NAME of a secret in Secret Manager. We never ask for, show or store the key itself.', validate: () => err('secretRef') }),
      dailyCap: mkField('Daily call cap', cap, { validate: () => err('dailyCap') }),
    };
    const typeFields = h('div.fgrid'); let tf = {}, probeBoxes = [];
    const collect = () => {
      const config = {};
      for (const f of CONNECTOR_TYPES[type].fields) config[f.key] = tf[f.key]?.get();
      const dailyCap = cap.value === '' ? null : Number(cap.value);
      return { name: name.value.trim(), type, intervalMin: interval.value === '' ? NaN : Number(interval.value), mode: mode.value, enabled: enabled.input.checked, secretRef: secret.value.trim() || undefined, dailyCap, config };
    };
    const errs = () => { const v = collect(); const e = validateConnectorForm(type, v, probes.map((p) => p.id)); const s = validateSecretRef(v.secretRef, CONNECTOR_TYPES[type].secret === 'required'); if (s) e.secretRef = s; return e; };
    const err = (k) => errs()[k] ?? null;
    function renderType() {
      const T = CONNECTOR_TYPES[type]; tf = {}; probeBoxes = [];
      typeInfo.replaceChildren(h('div.row.between', h('b', T.label), h('button.btn.sm.ghost', { type: 'button', onclick: () => guide(type) }, 'Integration guide')), h('p.sm.muted', T.blurb), h('div.xs.faint', 'Needs: ' + T.needs.join('; ')));
      const nodes = [];
      for (const f of T.fields) {
        const initial = c?.config?.[f.key] ?? f.default;
        const w = fieldWidget(f, initial); tf[f.key] = w;
        const wrap = mkField(f.label, w.node, { required: f.required, hint: f.hint, validate: () => err(f.key), cls: f.type === 'mapping' || f.type === 'probes' ? 'full' : '' });
        w.field = wrap; nodes.push(wrap);
        if (f.key === 'target') w.node.addEventListener('change', () => { tf.mapping?.rebuild(w.get()); });
      }
      if (tf.mapping) tf.mapping.rebuild(tf.target?.get() ?? 'events', c?.config?.mapping);
      { common.secretRef.querySelector('label').firstChild.textContent = T.secret === 'required' ? 'Secret name (secretRef) *' : 'Secret name (secretRef, optional)'; }
      nodes.push(...(T.secret === 'none' ? [] : [common.secretRef]));
      if (T.paid) nodes.push(common.dailyCap);
      typeFields.replaceChildren(...nodes);
    }
    typeSel.addEventListener('change', () => { type = typeSel.value; clearSummary(summary); renderType(); });
    renderType();
    const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary, edit ? null : h('div', mkField('Connector type', typeSel, { required: true })), typeInfo,
      h('div.fgrid', common.name, common.intervalMin, common.mode, h('div.field', h('label', 'Enabled'), h('div.row', enabled, h('span.sm.muted', 'Runs on schedule when on')))), typeFields);
    openDialog({ title: edit ? `Edit ${c.name}` : 'Add connector', size: 'xl', content, actions: [{ label: 'Cancel', value: null }, { label: edit ? 'Save changes' : 'Create connector', kind: 'primary', attrs: { id: 'connector-save' }, onClick: async () => {
      const e = errs(); const fields = [common.name, common.intervalMin, ...Object.values(tf).map((w) => w.field), common.secretRef, common.dailyCap].filter((f) => f && f.isConnected !== false);
      fields.forEach((f) => f.check()); const bad = fields.filter((f) => f.dataset.err);
      if (bad.length) { showSummary(summary, `${bad.length} field${bad.length > 1 ? 's need' : ' needs'} attention`, bad.map((f) => ({ text: `${f.fieldLabel}: ${f.dataset.err}`, focus: f.ctl }))); bad[0].ctl.focus(); return false; }
      const v = collect(); const body = { name: v.name, intervalMin: v.intervalMin, mode: v.mode, enabled: v.enabled, config: v.config, secretRef: v.secretRef ?? null, dailyCap: v.dailyCap };
      try { if (edit) await api.patch(`/admin/connectors/${encodeURIComponent(c.id)}`, body); else await api.post('/admin/connectors', { ...body, type }); }
      catch (x) { serverError(summary, x); return false; }
      toast(edit ? `Saved ${v.name}` : `Created ${v.name}. Test it, then run it.`, 'good'); reload();
    } }] });
  }

  /** Widget for one schema field. node: element (with .input focus target); get(): value. */
  function fieldWidget(f, initial) {
    if (f.type === 'select') { const s = select(f.options, initial ?? f.default); return { node: s, get: () => s.value }; }
    if (f.type === 'number') { const i = input({ type: 'number', value: initial ?? '', min: f.min, max: f.max }); return { node: i, get: () => (i.value === '' ? undefined : Number(i.value)) }; }
    if (f.type === 'tags') {
      let tags = [...(initial ?? [])]; const inp = input({ placeholder: f.ph ?? 'Add and press Enter', 'aria-label': f.label }); const box = h('div.tags', inp); box.input = inp;
      const draw = () => { box.querySelectorAll('.tag').forEach((n) => n.remove()); tags.forEach((t, i) => box.insertBefore(h('span.tag', t, h('button', { type: 'button', 'aria-label': `Remove ${t}`, onclick: () => { tags.splice(i, 1); draw(); inp.dispatchEvent(new Event('input')); } }, '×')), inp)); };
      const add = () => { const v = inp.value.trim().replace(/,$/, ''); if (v && !tags.includes(v)) { tags.push(v); draw(); } inp.value = ''; };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); draw(); } });
      inp.addEventListener('blur', add); draw(); return { node: box, get: () => { add(); return tags; } };
    }
    if (f.type === 'probes') {
      const sel = new Set(initial ?? []); const box = h('div.checks', { tabindex: '-1' }); box.input = null;
      if (!probes.length) box.append(h('p.sm.muted', 'No probes defined yet. ', h('a', { href: '#/probes' }, 'Create probes first'), '.'));
      probes.forEach((p, i) => { const cb = h('input', { type: 'checkbox', id: 'pb-' + p.id, value: p.id }); cb.checked = sel.has(p.id); if (i === 0) box.input = cb; box.append(h('label', { for: cb.id }, cb, h('span', p.name, h('span.faint.xs', `  ${p.fromLabel} to ${p.toLabel}`)))); });
      box.input ??= box;
      return { node: box, get: () => [...box.querySelectorAll('input:checked')].map((x) => x.value) };
    }
    if (f.type === 'mapping') {
      const box = h('div.stack', { tabindex: '-1', style: { gap: '6px' } }); let inputs = {}; box.input = null; let last = initial ?? {};
      const api2 = { node: box, get: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]).filter(([, v]) => v)), rebuild(target, init) {
        if (inputs && Object.keys(inputs).length) last = api2.get(); if (init) last = init; inputs = {}; box.input = null;
        box.replaceChildren(...MAPPINGS[target ?? 'events'].map(([k, label, req], i) => { const inp = input({ value: last[k] ?? '', placeholder: 'path.in.record', 'aria-label': `${label} source field`, 'data-map': k }); inputs[k] = inp; if (i === 0) box.input = inp; return h('div.maprow', h('label.sm', { for: (inp.id = 'mp-' + k) }, label, req ? h('span.req', ' *') : null, h('code.faint', `  ${k}`)), inp); }));
      } };
      return api2;
    }
    const i = input({ type: f.type === 'url' ? 'url' : 'text', value: initial ?? '', placeholder: f.ph ?? '' }); return { node: i, get: () => i.value.trim() };
  }
}
