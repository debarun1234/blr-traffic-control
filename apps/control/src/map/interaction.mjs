// Pointer / wheel / keyboard interaction for the map canvas.
import { S, emit, setSel, setTab } from '../state.mjs';
import { pickEdge, pickIncident } from './picking.mjs';

export function attachInteraction(canvas, R, hooks) {
  const ptrs = new Map(); let moved = 0, lastPinch = 0, hovPending = false;
  const rect = () => canvas.getBoundingClientRect();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; canvas.classList.add('drag');
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId), r = rect();
    if (p) {
      if (ptrs.size === 2) {
        p.x = e.clientX; p.y = e.clientY; const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) R.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / lastPinch);
        lastPinch = d; moved = 99;
      } else {
        const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
        R._anim = (R._anim ?? 0) + 1; R.view.cx -= dx / R.view.k; R.view.cy += dy / R.view.k; p.x = e.clientX; p.y = e.clientY; R.dirty = true; hooks.hideTip();
      }
    } else hover(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = moved < 5 && ptrs.has(e.pointerId) && ptrs.size === 1;
    ptrs.delete(e.pointerId); lastPinch = 0; if (!ptrs.size) canvas.classList.remove('drag');
    if (wasClick) { const r = rect(); click(e.clientX - r.left, e.clientY - r.top); }
  });
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); canvas.classList.remove('drag'); });
  canvas.addEventListener('pointerleave', () => { if (S.hover) { S.hover = null; R.dirty = true; } hooks.hideTip(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = rect(); R.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const r = rect(); R.zoomAt(e.clientX - r.left, e.clientY - r.top, 2); });
  canvas.addEventListener('keydown', (e) => {
    const step = 90 / R.view.k, K = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (K) { R.view.cx += K[0] * step; R.view.cy += K[1] * step; R.dirty = true; e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { R.zoomAt(R.W / 2, R.H / 2, 1.4); e.preventDefault(); }
    else if (e.key === '-') { R.zoomAt(R.W / 2, R.H / 2, 1 / 1.4); e.preventDefault(); }
  });

  function hover(mx, my) {
    if (hovPending) return; hovPending = true;
    requestAnimationFrame(() => {
      hovPending = false;
      const m = pickIncident(R, mx, my), e = m ? m.e : pickEdge(R, mx, my, 7), prev = S.hover?.e;
      S.hover = { e, incident: m?.id }; if (prev !== e) R.dirty = true;
      const si = S.MD.stAt(R.wx(mx), R.wy(my));
      hooks.showTip({ e, si, mx, my, incident: m?.id });
    });
  }
  function click(mx, my) {
    const m = pickIncident(R, mx, my); const e = m ? m.e : pickEdge(R, mx, my, 9);
    if (e >= 0) { setSel({ t: 'edge', e }); setTab(m ? 'actions' : 'station'); }
    else {
      const si = S.MD.stAt(R.wx(mx), R.wy(my));
      if (si >= 0 && R.regAlpha(S.MD.ST[si].ri) > 0.5) { setSel({ t: 'st', i: si }); setTab('station'); } else setSel(null);
    }
    R.dirty = true; emit('view');
  }
}
