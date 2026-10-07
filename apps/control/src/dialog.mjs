// Accessible modal dialog: focus trap, Esc to close, focus restore, aria-modal.
import { h } from '/vendor/ui.mjs';
import { t } from './i18n.mjs';
import { ic } from './icons.mjs';

let seq = 0;
export function openDialog({ title, body, wide = false, onClose, testid }) {
  const prev = document.activeElement, id = `dlg-${++seq}`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', key, true); onClose?.(); if (prev && prev.focus) prev.focus(); };
  const box = h('div.modal.cc-dialog' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: -1, 'data-testid': testid },
    h('div.row.between.nowrap', h('h2', { id }, title), h('button.btn.sm.ghost', { 'aria-label': t('close'), onclick: close }, ic('x', 16))), h('div.cc-dialog-b', body));
  const bg = h('div.modal-bg', { onmousedown: (e) => { if (e.target === bg) close(); } }, box);
  function key(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
  }
  document.addEventListener('keydown', key, true);
  document.body.append(bg);
  (box.querySelector('input,select,textarea') ?? box).focus();
  return { close, el: box };
}

/** Promise-based confirmation using the accessible dialog. Resolves true / false. */
export function confirmDialog(title, text, okLabel, danger = false) {
  return new Promise((resolve) => {
    let answered = false; let dlg;
    const done = (v) => { if (answered) return; answered = true; resolve(v); dlg.close(); };
    dlg = openDialog({ title, testid: 'confirm', onClose: () => { if (!answered) { answered = true; resolve(false); } },
      body: h('div.stack', h('p.muted', text), h('div.row', { style: { justifyContent: 'flex-end' } }, h('button.btn', { onclick: () => done(false) }, t('cancel')), h('button.btn' + (danger ? '.danger' : '.primary'), { 'data-testid': 'confirm-ok', onclick: () => done(true) }, okLabel))) });
  });
}
