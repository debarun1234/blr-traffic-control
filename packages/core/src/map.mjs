import { loadMap } from '@blr/mapdata';
import { createNetwork } from '@blr/model';
import { canonStation } from '@blr/shared';
let net;
/** Shared, lazily built network (building is ~100 ms; assignment dominates). */
export function getNet() { return (net ??= createNetwork(loadMap())); }

const M_PER_UNIT = 2.2, M_PER_DEG = 111320;
export function xyToLatLon(map, x, y) {
  const lat = map.o[1] + (y * M_PER_UNIT) / M_PER_DEG;
  return { lat, lon: map.o[0] + (x * M_PER_UNIT) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)) };
}
export function latLonToXY(map, lat, lon) {
  return { x: ((lon - map.o[0]) * M_PER_DEG * Math.cos((lat * Math.PI) / 180)) / M_PER_UNIT, y: ((lat - map.o[1]) * M_PER_DEG) / M_PER_UNIT };
}
export const nodeLatLon = (net, node) => xyToLatLon(net.map, net.map.nxy[node][0], net.map.nxy[node][1]);

/** Nearest routable edge to lat/lon within maxM metres, or null. Linear scan (10k edges). */
export function snapToEdge(net, lat, lon, maxM = 150) {
  const { x, y } = latLonToXY(net.map, lat, lon), nxy = net.map.nxy;
  let best = -1, bd = Infinity;
  for (let e = 0; e < net.ne; e++) {
    const A = nxy[net.a[e]], B = nxy[net.b[e]];
    const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - A[0]) * dx + (y - A[1]) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (A[0] + t * dx), y - (A[1] + t * dy));
    if (d < bd) { bd = d; best = e; }
  }
  return bd * M_PER_UNIT <= maxM ? best : null;
}
export const stationName = (net, e) => net.map.st[net.stn[e]]?.n ?? null;
export const stationRegion = (net, name) => net.map.st.find((s) => s.n === name)?.r ?? null;
export const roadName = (net, e) => (net.name[e] >= 0 ? net.map.n[net.name[e]] : null);
export const stationNames = (net) => net.map.st.map((s) => s.n);
/** Find a station by exact (case-insensitive) name or admin alias. */
export function resolveStation(net, s, overrides = []) {
  const q = String(s ?? '').trim().toLowerCase(); if (!q) return null;
  const hit = net.map.st.find((x) => x.n.toLowerCase() === q) ?? net.map.st.find((x) => x.n === canonStation(String(s).trim())); if (hit) return hit.n;
  for (const o of overrides) if ((o.aliases ?? []).some((a) => String(a).toLowerCase() === q)) return o.name;
  return null;
}
