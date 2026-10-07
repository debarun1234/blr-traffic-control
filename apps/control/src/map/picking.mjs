// Hit testing against the draw polylines (screen-space tolerance).
import { S } from '../state.mjs';

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy;
}
/** Nearest routed edge within `tol` px of (mx,my), or -1. Dimmed regions are not pickable. */
export function pickEdge(R, mx, my, tol) {
  const { map, DX, RT, DREG } = S.MD;
  const x0 = R.wx(mx - tol), x1 = R.wx(mx + tol), y1 = R.wy(my - tol), y0 = R.wy(my + tol);
  let best = -1, bd = tol * tol;
  for (const i of RT) {
    if (!R.visItem(i, x0, y0, x1, y1)) continue;
    const ra = DREG[i]; if (ra >= 0 && R.regAlpha(ra) < 0.5) continue;
    const a = DX[i];
    for (let j = 0; j + 3 < a.length; j += 2) {
      const d = segDist2(mx, my, R.sx(a[j]), R.sy(a[j + 1]), R.sx(a[j + 2]), R.sy(a[j + 3]));
      if (d < bd) { bd = d; best = map.d[i][4]; }
    }
  }
  return best;
}
export function pickIncident(R, mx, my, tol = 11) {
  let best = null, bd = tol * tol;
  for (const m of R.markers) { const d = (m.x - mx) ** 2 + (m.y - my) ** 2; if (d < bd) { bd = d; best = m; } }
  return best;
}
