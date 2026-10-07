import { roadName } from '../map.mjs';

/**
 * Shortest detour around edge `e` that avoids every edge of the same road name (or just `e` if unnamed).
 * Plain Dijkstra on length, bounded to `maxM` metres. Returns {roads:[names], extraM, lengthM} or null.
 */
export function detourAround(net, e, maxM = 6000) {
  const src = net.a[e], dst = net.b[e], nm = net.name[e];
  const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist.get(u)) continue; if (u === dst) break; if (d > maxM) break;
    for (let q = net.off[u]; q < net.off[u + 1]; q++) {
      const ed = net.arc[q] >> 1; if (ed === e || (nm >= 0 && net.name[ed] === nm)) continue;
      const v = net.to[q], nd = d + net.len[ed];
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, ed); push([nd, v]); }
    }
  }
  if (!dist.has(dst) || dist.get(dst) > maxM) return null;
  const roads = []; let v = dst;
  while (v !== src) { const ed = prev.get(v); const n = roadName(net, ed); if (n && !roads.includes(n)) roads.unshift(n); v = net.a[ed] === v ? net.b[ed] : net.a[ed]; }
  return { roads: roads.slice(0, 4), extraM: Math.max(0, Math.round(dist.get(dst) - net.len[e])), lengthM: Math.round(dist.get(dst)) };
}
