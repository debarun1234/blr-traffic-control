// Small DOM + timing helpers on top of /vendor/ui.mjs.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }
export const lsGet = (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
export const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

/**
 * Keyed incremental list update: rebuilds only items whose signature changed, reorders in place,
 * and restores focus to an element carrying the same data-fk if the focused element was replaced.
 */
export function reconcile(parent, items, keyFn, sigFn, build) {
  const old = parent._rec ?? new Map(), next = new Map(), order = [];
  const ae = document.activeElement, fk = ae && parent.contains(ae) ? ae.dataset?.fk : null;
  for (const it of items) {
    const k = keyFn(it), sig = sigFn(it); let ent = old.get(k);
    if (!ent || ent.sig !== sig) { if (ent) ent.el.remove(); ent = { sig, el: build(it) }; }
    next.set(k, ent); order.push(ent.el);
  }
  for (const [k, e] of old) if (!next.has(k)) e.el.remove();
  order.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null); });
  parent._rec = next;
  if (fk && (!document.activeElement || document.activeElement === document.body)) parent.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus();
}

/** Coalesce many calls into one per animation frame. */
export function frame(fn) { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; }
export const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 16));

/** Text -> array of {list:boolean, lines:[]} blocks; rendered with textContent only by callers. */
export function textBlocks(text) {
  const blocks = []; let cur = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line) { cur = null; continue; }
    const m = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) { if (!cur || !cur.list) blocks.push((cur = { list: true, lines: [] })); cur.lines.push(m[2]); }
    else { blocks.push({ list: false, lines: [line] }); cur = null; }
  }
  return blocks;
}
/** replaceChildren that ignores null/false (the DOM would stringify them). */
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
