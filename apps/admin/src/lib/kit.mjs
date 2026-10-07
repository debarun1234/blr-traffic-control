/** Admin UI kit built on packages/ui: fields + validation, tables, dialogs/drawers (focus-trapped), states, downloads. */
import { h, icon, toast, esc } from '../vendor/ui.mjs';
export { h, icon, toast, esc };
import { errMsg } from './api.mjs';

let seq = 0;
export const uid = (p = 'id') => `${p}-${++seq}`;
export const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const [t, ...cls] = tag.split('.'); const e = document.createElementNS(NS, t); if (cls.length) e.setAttribute('class', cls.join(' '));
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

/* ---------- fields ---------- */
export function input(o = {}) { const { value, ...rest } = o; const e = h('input.input', { type: 'text', autocomplete: 'off', spellcheck: false, ...rest }); if (value != null) e.value = value; return e; }
export function textarea(o = {}) { const { value, ...rest } = o; const e = h('textarea.textarea', { spellcheck: false, ...rest }); if (value != null) e.value = value; return e; }
export function select(options, value, o = {}) {
  const e = h('select.select', o, options.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v }, l); }));
  if (value != null) e.value = value; return e;
}
export function toggle(checked, label, o = {}) {
  const cb = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, ...o }); cb.checked = !!checked;
  const w = h('span.switch', cb, h('i')); w.input = cb; return w;
}
/** Wrap a control with label, hint and inline error. `validate(value)` returns a message or null. */
export function mkField(label, control, { hint, validate, required, cls = '' } = {}) {
  const ctl = control.input ?? control; const id = ctl.id || (ctl.id = uid('f'));
  const err = h('div.ferr.hide', { id: id + '-err' });
  const d = [hint ? id + '-hint' : null, id + '-err'].filter(Boolean).join(' ');
  ctl.setAttribute('aria-describedby', d); if (required) ctl.setAttribute('aria-required', 'true');
  const w = h('div.field' + (cls ? '.' + cls : ''), h('label', { for: id }, label, required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null), control, hint ? h('div.hint', { id: id + '-hint' }, hint) : null, err);
  w.ctl = ctl; w.fieldLabel = label;
  const val = () => (ctl.type === 'checkbox' ? ctl.checked : ctl.value);
  w.setError = (m) => { err.textContent = m || ''; err.classList.toggle('hide', !m); ctl.setAttribute('aria-invalid', m ? 'true' : 'false'); w.dataset.err = m || ''; };
  w.check = () => { const m = validate ? validate(val()) : null; w.setError(m); return !m; };
  ctl.addEventListener('input', () => { if (w.dataset.err) w.check(); });
  return w;
}
export const errorSummary = () => h('div.banner.bad.errsum.hide', { role: 'alert', tabindex: '-1' });
export function showSummary(el, title, items) {
  el.replaceChildren(h('div', h('strong', title), h('ul', items.map((i) => h('li', i.focus ? h('button.linklike', { type: 'button', onclick: () => i.focus.focus() }, i.text) : i.text)))));
  el.classList.remove('hide'); el.focus();
}
export const clearSummary = (el) => { el.classList.add('hide'); el.replaceChildren(); };
/** Run each field's check, fill the summary, focus the first problem. */
export function validateFields(fields, summary) {
  const bad = fields.filter((f) => !f.check());
  if (bad.length) { showSummary(summary, `${bad.length} field${bad.length > 1 ? 's need' : ' needs'} attention`, bad.map((f) => ({ text: `${f.fieldLabel}: ${f.dataset.err}`, focus: f.ctl }))); bad[0].ctl.focus(); } else clearSummary(summary);
  return !bad.length;
}
export function serverError(summary, e) { showSummary(summary, 'The server rejected this change', [{ text: errMsg(e) }]); }

/** Disable a button while an async action runs. Errors become a toast unless handled by the caller. */
export async function busy(btn, fn, { toastErr = true } = {}) {
  const label = btn?.textContent; if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  catch (e) { if (toastErr) toast(errMsg(e), 'bad', 6000); else throw e; }
  finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = label; } }
}

/* ---------- states ---------- */
export const skeleton = (rows = 5) => h('div.stack.sk-wrap', { 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: rows }, (_, i) => h('div.skel', { style: { height: '34px', opacity: String(1 - i * 0.12) } })));
export const emptyState = (title, text, action) => h('div.empty', h('div.empty-i', icon('layers', 28)), h('strong', { style: { color: 'var(--ink-2)' } }, title), text ? h('p.sm', text) : null, action ? h('div', { style: { marginTop: '12px' } }, action) : null);
export const errorState = (e, retry) => h('div.empty', { role: 'alert' }, h('div.empty-i.bad', icon('alert', 28)), h('strong', { style: { color: 'var(--bad)' } }, 'Could not load this'), h('p.sm', errMsg(e)), retry ? h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: retry }, 'Try again')) : null);
export function pageHeader(title, sub, ...actions) { return h('div.page-h', h('div', h('h1', title), sub ? h('p', sub) : null), h('div.row', actions)); }

/** Load async content into a container with skeleton + error state. Returns a reload function. */
export function loader(container, fn, { rows = 6 } = {}) {
  let tok = 0;
  const run = async () => {
    const my = ++tok; container.replaceChildren(skeleton(rows));
    try { const n = await fn(); if (my !== tok) return; container.replaceChildren(n); }
    catch (e) { if (my !== tok) return; container.replaceChildren(errorState(e, run)); }
  };
  run(); return run;
}

/* ---------- badges ---------- */
export const STATUS = { ok: ['good', 'OK'], warn: ['warn', 'Warning'], fail: ['bad', 'Failing'], off: ['', 'Off'], unknown: ['', 'No data'] };
export function statusBadge(s, label) { const [k, l] = STATUS[s] ?? STATUS.unknown; return h('span.badge' + (k ? '.' + k : ''), h('span.dot' + (k ? '.' + k : '')), label ?? l); }
export const roleBadge = (r) => h('span.badge' + (r === 'admin' ? '.accent' : ''), r);

/* ---------- table ---------- */
/** cols: [{h, cell(row)->Node|string, cls?, sort?(row)->comparable, w?}] */
export function dataTable({ cols, rows = [], empty, rowAttrs, caption, sort: initSort }) {
  const wrap = h('div.tbl-wrap'); let data = rows, sortIdx = initSort?.col ?? -1, dir = initSort?.dir ?? 1;
  const render = () => {
    const sorted = sortIdx >= 0 && cols[sortIdx].sort ? [...data].sort((a, b) => { const x = cols[sortIdx].sort(a), y = cols[sortIdx].sort(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }) : data;
    const head = h('tr', cols.map((c, i) => h('th', { class: c.cls ?? '', scope: 'col', 'aria-sort': i === sortIdx ? (dir > 0 ? 'ascending' : 'descending') : (c.sort ? 'none' : null), style: c.w || c.minw ? { width: c.w, minWidth: c.minw } : null },
      c.sort ? h('button.thbtn', { type: 'button', onclick: () => { dir = sortIdx === i ? -dir : 1; sortIdx = i; render(); } }, c.h, h('span', { 'aria-hidden': 'true' }, i === sortIdx ? (dir > 0 ? ' ▲' : ' ▼') : '')) : c.h)));
    const body = sorted.map((r) => h('tr', rowAttrs?.(r) ?? {}, cols.map((c) => h('td', { class: c.cls ?? '' }, c.cell(r)))));
    wrap.replaceChildren(sorted.length ? h('table.tbl', caption ? h('caption.sr', caption) : null, h('thead', head), h('tbody', body)) : (empty ?? emptyState('Nothing here yet')));
  };
  render();
  return { el: wrap, set(r) { data = r; render(); } };
}

/* ---------- dialogs & drawers ---------- */
const stack = [];
function refreshInert() {
  const app = document.getElementById('app'); if (app) (stack.length ? app.setAttribute('inert', '') : app.removeAttribute('inert'));
  stack.forEach((s, i) => (i < stack.length - 1 ? s.bg.setAttribute('inert', '') : s.bg.removeAttribute('inert')));
}
/** openDialog({title, content, actions:[{label,kind,value,onClick}], size, drawer, persistent}). `onClick(d)` may return false to stay open. */
export function openDialog({ title, content, actions = [], size = '', drawer = false, persistent = false, desc }) {
  const prev = document.activeElement; const tid = uid('dlg');
  let resolve; const closed = new Promise((r) => (resolve = r)); let isClosed = false;
  const d = { closed, close: (v = null) => { if (isClosed) return; isClosed = true; document.removeEventListener('keydown', onKey, true); { const i = stack.findIndex((s) => s.bg === bg); if (i >= 0) stack.splice(i, 1); } bg.remove(); refreshInert(); if (prev?.isConnected) prev.focus(); resolve(v); }, el: null, buttons: [] };
  const btns = actions.map((a) => {
    const b = h('button.btn' + (a.kind ? '.' + a.kind : ''), { type: 'button', ...(a.attrs ?? {}), onclick: async () => {
      if (!a.onClick) return d.close(a.value);
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      try { const r = await a.onClick(d); if (r !== false) d.close(a.value); } finally { b.disabled = false; b.removeAttribute('aria-busy'); }
    } }, a.label);
    return b;
  });
  d.buttons = btns;
  const panel = h('div.' + (drawer ? 'drawer' : 'modal') + (size ? '.' + size : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, tabindex: '-1' },
    h('div.dlg-h', h('h2', { id: tid }, title), drawer ? h('button.btn.ghost.sm', { type: 'button', 'aria-label': 'Close', onclick: () => d.close(null) }, '✕') : null),
    desc ? h('p.muted.sm', desc) : null,
    h('div.dlg-b', content),
    btns.length ? h('div.row.dlg-f', btns) : null);
  const bg = h('div.modal-bg' + (drawer ? '.drawer-bg' : ''), { onmousedown: (e) => { if (e.target === bg && !persistent) d.close(null); } }, panel);
  d.el = panel;
  const focusables = () => [...panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null || n === document.activeElement);
  function onKey(e) {
    if (stack.at(-1)?.bg !== bg) return;
    if (e.key === 'Escape' && !persistent) { e.stopPropagation(); d.close(null); }
    if (e.key === 'Tab') { const f = focusables(); if (!f.length) { e.preventDefault(); return; } const i = f.indexOf(document.activeElement); if (e.shiftKey && (i <= 0)) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && (i === f.length - 1)) { e.preventDefault(); f[0].focus(); } }
  }
  stack.push({ bg }); refreshInert();
  document.body.append(bg); document.addEventListener('keydown', onKey, true);
  queueMicrotask(() => { if (drawer) return panel.focus({ preventScroll: true }); (panel.querySelector('[data-autofocus]') ?? panel.querySelector('input:not([type=hidden]),select,textarea') ?? btns.at(-1) ?? panel).focus(); });
  return d;
}
export const confirmDialog = ({ title, text, ok = 'Confirm', danger = false, content }) =>
  openDialog({ title, content: content ?? h('p.muted', text), size: 'sm', actions: [{ label: 'Cancel', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true, attrs: { 'data-autofocus': '' } }] }).closed.then((v) => v === true);

/* ---------- misc ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }); t.value = text; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; }
}
export function download(name, data, type = 'text/csv') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
export const fmtMs = (ms) => (ms == null ? '-' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');
export const fmtUsd = (n) => (n == null ? '-' : '$' + Number(n).toFixed(n < 10 ? 2 : 0));
export const fmtDT = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');
export const when = (ms, ago) => (ms ? h('span', { title: fmtDT(ms) }, ago(ms)) : h('span.faint', 'never'));
export function tabs(items, active, onChange) {
  const list = h('div.tabs', { role: 'tablist' });
  const btns = items.map(([id, label]) => h('button.tab', { role: 'tab', id: 'tab-' + id, type: 'button', 'aria-selected': String(id === active), tabindex: id === active ? '0' : '-1', onclick: () => set(id) }, label));
  const set = (id) => { btns.forEach((b, i) => { const on = items[i][0] === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }); onChange(id); };
  list.addEventListener('keydown', (e) => { const i = btns.indexOf(document.activeElement); if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const n = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length]; n.focus(); n.click(); });
  list.append(...btns); return list;
}
export function codeBlock(text, label = 'Copy') {
  const pre = h('pre.code', h('code', text)); const b = h('button.btn.sm.copy', { type: 'button', onclick: async () => { const ok = await copyText(text); toast(ok ? 'Copied' : 'Copy failed. Select the text manually.', ok ? 'good' : 'bad', 2000); } }, label);
  return h('div.codewrap', b, pre);
}
