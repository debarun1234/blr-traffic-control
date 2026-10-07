import { h, toast, ago } from '../vendor/ui.mjs';
import { api, list, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, mkField, input, errorSummary, validateFields, serverError, openDialog, confirmDialog, copyText, fmtDT } from '../lib/kit.mjs';

const SCOPES = [['events', 'events', 'POST /ingest/v1/events: incidents from ANPR, ASTraM, field systems'], ['speeds', 'speeds', 'POST /ingest/v1/speeds: corridor travel times for calibration'], ['works', 'works', 'POST /ingest/v1/works: road works from GBA / BMRCL']];

export async function mount(root, ctx) {
  let keys = [], showRevoked = false;
  const host = h('div');
  root.append(pageHeader('API keys', 'Keys let external systems push data to /ingest/v1/* with the x-api-key header. A key only works for the scopes you tick, and is rate limited. Keys are stored as SHA-256 hashes: the full key is shown once at creation and cannot be recovered.',
    h('button.btn.primary', { onclick: createDialog }, '+ Create key')), host);

  const table = dataTable({ caption: 'API keys', cols: [
    { h: 'Name', cell: (k) => h('b', k.name) },
    { h: 'Key', cell: (k) => h('span.mono', `${k.prefix}…`) },
    { h: 'Scopes', cell: (k) => h('span.pill-row', k.scopes.map((s) => h('span.badge.info', s))) },
    { h: 'Rate limit', cls: 'n', cell: (k) => `${k.rateLimit}/min` },
    { h: 'Created', cell: (k) => h('span', { title: fmtDT(k.createdAt) }, ago(k.createdAt), h('span.sub', 'by ' + k.createdBy)) },
    { h: 'Last used', cell: (k) => (k.lastUsed ? h('span', { title: fmtDT(k.lastUsed) }, ago(k.lastUsed)) : h('span.faint', 'Never used')) },
    { h: 'Status', cell: (k) => (k.revoked ? h('span.badge.bad', 'Revoked') : h('span.badge.good', 'Active')) },
    { h: 'Actions', cls: 'act', cell: (k) => (k.revoked ? null : h('button.btn.sm', { 'aria-label': `Revoke key ${k.name}`, onclick: () => revoke(k) }, 'Revoke')) },
  ], rowAttrs: (k) => ({ class: k.revoked ? 'dim' : '', dataset: { keyname: k.name } }) });

  const reload = loader(host, async () => {
    keys = list(await api.get('/admin/apikeys'), 'keys'); return view();
  });
  function view() {
    const shown = keys.filter((k) => showRevoked || !k.revoked);
    const cb = h('input', { type: 'checkbox', id: 'k-rev', onchange: () => { showRevoked = cb.checked; host.replaceChildren(view()); } }); cb.checked = showRevoked;
    table.set(shown);
    if (!shown.length) return h('div', emptyState('No API keys yet', 'Create a key for each external system so you can revoke one without affecting the others.', h('button.btn.primary', { onclick: createDialog }, '+ Create key')));
    return h('div', h('div.filters', h('label.row', { for: 'k-rev' }, cb, 'Show revoked keys')), table.el, h('p.faint.sm', { style: { marginTop: '8px' } }, 'Use one key per system. Rotate by creating a new key, switching the sender, then revoking the old one.'));
  }

  function createDialog() {
    const summary = errorSummary();
    const name = input({ placeholder: 'e.g. ANPR vendor - Silk Board' });
    const rate = input({ type: 'number', value: '60', min: '1', max: '6000' });
    const fName = mkField('Name', name, { required: true, hint: 'Who or what will use this key. Shown in the audit log.', validate: (v) => (v.trim().length < 3 ? 'At least 3 characters.' : null) });
    const fRate = mkField('Rate limit (requests per minute)', rate, { validate: (v) => (Number.isInteger(+v) && +v >= 1 && +v <= 6000 ? null : 'Whole number, 1 to 6000.') });
    const boxes = SCOPES.map(([id, , d]) => { const cb = h('input', { type: 'checkbox', value: id, id: 'sc-' + id }); return { id, cb, row: h('label.row.nowrap', { for: 'sc-' + id, style: { alignItems: 'flex-start' } }, cb, h('span', h('b.mono', id), h('span.sub', d))) }; });
    const scopeErr = h('div.ferr.hide', { role: 'alert' }, 'Pick at least one scope.');
    const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary, fName,
      h('fieldset.stack', { style: { border: 0, padding: 0, margin: 0 } }, h('legend.sm.muted', { style: { fontWeight: 550, marginBottom: '6px' } }, 'Scopes *'), boxes.map((b) => b.row), scopeErr), fRate);
    openDialog({ title: 'Create API key', content, actions: [{ label: 'Cancel', value: null }, { label: 'Create key', kind: 'primary', onClick: async () => {
      const scopes = boxes.filter((b) => b.cb.checked).map((b) => b.id); scopeErr.classList.toggle('hide', !!scopes.length);
      if (!validateFields([fName, fRate], summary) || !scopes.length) return false;
      let r; try { r = await api.post('/admin/apikeys', { name: name.value.trim(), scopes, rateLimit: +rate.value }); } catch (e) { serverError(summary, e); return false; }
      reload(); setTimeout(() => reveal(r), 0);
    } }] });
  }
  function reveal(r) {
    const plain = r.key ?? r.plaintext ?? r.apiKey; const meta = r.apikey ?? r.record ?? r;
    const status = h('span.sm.good', { role: 'status' });
    const content = h('div.stack',
      h('div.banner', h('span', h('b', 'Copy this key now.'), ' It is shown once. We keep only a hash, so it cannot be shown again; if you lose it, create a new key and revoke this one.')),
      h('div.keybox', { id: 'plaintext-key', tabindex: '0', 'aria-label': 'API key' }, plain),
      h('div.row', h('button.btn.primary', { 'data-autofocus': '', onclick: async () => { const ok = await copyText(plain); status.textContent = ok ? 'Copied to clipboard' : 'Copy failed: select the key and copy it manually'; if (!ok) status.className = 'sm bad'; } }, 'Copy key'), status),
      h('p.sm.muted', 'Send it as a header: ', h('code', 'x-api-key: ' + (meta.prefix ?? plain.slice(0, 8)) + '…'), `. Scopes: ${(meta.scopes ?? []).join(', ')}.`));
    openDialog({ title: `Key created: ${meta.name ?? ''}`, content, persistent: true, actions: [{ label: "I have stored the key", kind: 'primary', value: true }] });
  }
  async function revoke(k) {
    const ok = await confirmDialog({ title: `Revoke "${k.name}"?`, text: `Requests using ${k.prefix}… are rejected immediately. This cannot be undone; create a new key if the sender still needs access.`, ok: 'Revoke key', danger: true });
    if (!ok) return;
    try { await api.del(`/admin/apikeys/${encodeURIComponent(k.id)}`); toast(`Revoked ${k.name}`, 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad', 6000); }
  }
}
