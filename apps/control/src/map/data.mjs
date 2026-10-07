// Map geometry prepared once: absolute draw polylines, bounding boxes, station/region lookup, road index.
import { createNetwork } from '/vendor/model.mjs';
import { REGIONS, REGION_INDEX } from '../analytics.mjs';

export const UNIT_M = 2.2; // metres per map unit

export function buildMapData(map) {
  const net = createNetwork(map), N = map.d.length, ST = map.st;
  const DX = new Array(N), DB = new Float32Array(N * 4), DREG = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const f = map.d[i][3], n = f.length / 2, a = new Float32Array(f.length);
    let x = f[0], y = f[1]; a[0] = x; a[1] = y;
    let x0 = x, x1 = x, y0 = y, y1 = y;
    for (let j = 1; j < n; j++) { x += f[2 * j]; y += f[2 * j + 1]; a[2 * j] = x; a[2 * j + 1] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    DX[i] = a; DB[4 * i] = x0; DB[4 * i + 1] = y0; DB[4 * i + 2] = x1; DB[4 * i + 3] = y1;
    const s = map.d[i][2]; DREG[i] = s >= 0 ? REGION_INDEX[ST[s].r] : -1;
  }
  const bb = (rings) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const r of rings) for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  const REGBOX = { All: bb(map.city) }; for (const r of REGIONS) REGBOX[r] = bb(map.reg[r]);
  const stIdx = new Map();
  ST.forEach((s, i) => { s.box = bb(s.poly); s.i = i; s.ri = REGION_INDEX[s.r]; stIdx.set(s.n, i); });
  const RT = []; for (let i = 0; i < N; i++) if (map.d[i][4] >= 0) RT.push(i);
  const edgeName = (e, fallback = '') => { const n = net.name[e]; return n >= 0 ? map.n[n] : fallback; };

  function pip(x, y, rings) {
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function stAt(x, y) { for (let i = 0; i < ST.length; i++) { const b = ST[i].box; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; if (pip(x, y, ST[i].poly)) return i; } return -1; }
  /** midpoint of an edge's drawn polyline */
  function edgeMid(e) { const a = DX[net.draw[e]], m = ((a.length / 4) | 0) * 2; return [a[m], a[m + 1]]; }
  /** roads (name idx + total length m) inside a station, longest first */
  function roadsIn(si, minLen = 400) {
    const out = [];
    for (const [n, byStn] of net.roads) { const es = byStn.get(si); if (!es) continue; let L = 0; for (const e of es) L += net.len[e]; if (L > minLen) out.push([n, L]); }
    return out.sort((a, b) => b[1] - a[1]);
  }
  return { map, net, N, ST, DX, DB, DREG, REGBOX, RT, stIdx, edgeName, stAt, edgeMid, roadsIn, hubs: map.hubs, NAMES: map.n };
}
