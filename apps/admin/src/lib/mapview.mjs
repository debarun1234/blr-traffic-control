/** Map data loader + a small themed canvas map (city outline, station polygons, hubs). Used by Stations, Probes. */
import { h } from '../vendor/ui.mjs';
let cache;
export function loadMap() { return (cache ??= fetch('./assets/map.json').then((r) => { if (!r.ok) throw new Error('Could not load assets/map.json'); return r.json(); })); }
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function mapCanvas(map, { ariaLabel, onPick, aspect } = {}) {
  const ring = map.city[0]; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 600; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const ratio = (x1 - x0) / (y1 - y0);
  const cv = h('canvas.mapcv', { role: 'img', 'aria-label': ariaLabel ?? 'Map of Bengaluru', style: { aspectRatio: String(aspect ?? ratio) } });
  let layers = [], view = null;
  function draw() {
    const W = cv.clientWidth; if (!W) return; const H = Math.round(W / (aspect ?? ratio)); const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0)); const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    const P = (x, y) => [ox + (x - x0) * sc, H - oy - (y - y0) * sc]; view = { sc, ox, oy, H, x0, y0 };
    c.fillStyle = cssVar('--map'); c.fillRect(0, 0, W, H);
    c.beginPath(); ring.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.closePath();
    c.fillStyle = cssVar('--land'); c.fill(); c.strokeStyle = cssVar('--line-2'); c.lineWidth = 1.5; c.stroke();
    for (const l of layers) l(c, P, { W, H, sc });
  }
  cv.addEventListener('click', (e) => {
    if (!onPick || !view) return; const r = cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    onPick(view.x0 + (px - view.ox) / view.sc, view.y0 + (view.H - view.oy - py) / view.sc);
  });
  new ResizeObserver(draw).observe(cv);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
  return { el: cv, setLayers(l) { layers = l; draw(); }, draw };
}
export const polyLayer = (polys, { fill, stroke, width = 1, dash } = {}) => (c, P) => {
  c.save(); if (dash) c.setLineDash(dash);
  for (const poly of polys) { for (const ring of poly) { c.beginPath(); ring.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.closePath(); if (fill) { c.fillStyle = typeof fill === 'function' ? fill() : fill; c.fill(); } if (stroke) { c.strokeStyle = typeof stroke === 'function' ? stroke() : stroke; c.lineWidth = width; c.stroke(); } } }
  c.restore();
};
export const dotLayer = (pts, { r = 4, color, ring, label } = {}) => (c, P) => {
  c.save(); c.font = '600 11px Inter,system-ui,sans-serif';
  for (const p of pts) { const [a, b] = P(p.x, p.y); c.beginPath(); c.arc(a, b, p.r ?? r, 0, 7); c.fillStyle = p.color ?? (typeof color === 'function' ? color() : color); c.fill(); if (ring ?? p.ring) { c.strokeStyle = cssVar('--surface'); c.lineWidth = 2; c.stroke(); } if (p.label ?? label) { c.fillStyle = cssVar('--ink'); c.fillText(p.label ?? '', a + 8, b + 4); } }
  c.restore();
};
export const lineLayer = (a, b, color) => (c, P) => { const [x1, y1] = P(...a), [x2, y2] = P(...b); c.save(); c.setLineDash([6, 4]); c.strokeStyle = color(); c.lineWidth = 2; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.restore(); };
