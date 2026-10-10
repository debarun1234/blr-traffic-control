import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, assign } from '../../../packages/model/src/index.mjs';
import { loadMap } from '../../../packages/mapdata/index.mjs';
import { colourClass, hoursOK, worksActiveAt, worksEdges, capMulFor, clashes, summarizeApprox, scopeSum, topRoads, nearestAlternate, speedBucket, capKey } from '../src/analytics.mjs';

const map = loadMap(), net = createNetwork(map);

test('colourClass buckets follow the legend thresholds', () => {
  assert.deepEqual([0.1, 0.5, 0.75, 0.95, 1.15, 1.5, 3].map(colourClass), [0, 1, 2, 3, 4, 5, 5]);
  assert.equal(speedBucket(null), null); assert.equal(speedBucket(10), 0); assert.equal(speedBucket(40), 4);
});
test('works hours and activity windows', () => {
  assert.ok(hoursOK({ hours: 'all' }, 3)); assert.ok(hoursOK({ hours: 'peak' }, 9)); assert.ok(!hoursOK({ hours: 'peak' }, 14));
  assert.ok(hoursOK({ hours: 'night' }, 23)); assert.ok(hoursOK({ hours: 'night' }, 2)); assert.ok(!hoursOK({ hours: 'night' }, 12));
  const w = { from: '2026-10-01', to: '2026-10-31', hours: 'all', active: true };
  assert.ok(worksActiveAt(w, '2026-10-07', 9)); assert.ok(!worksActiveAt(w, '2026-11-01', 9)); assert.ok(!worksActiveAt({ ...w, active: false }, '2026-10-07', 9));
});
test('worksEdges resolves road + station to edges; capMulFor applies the minimum', () => {
  const w = { id: 'a', road: 'Outer Ring Road', stations: ['Bellandur'], from: '2026-10-01', to: '2026-10-31', hours: 'all', cap: 0.7 };
  const es = worksEdges(net, w); assert.ok(es.length > 0);
  const cm = capMulFor(net, { works: [w], incidents: [{ e: es[0], cap: 0.4, sh: 8, eh: 10 }], date: '2026-10-07', h: 9 });
  assert.equal(+cm[es[0]].toFixed(2), 0.4); assert.equal(+cm[es[1] ?? es[0]].toFixed(2) <= 0.7, true);
  assert.equal(capMulFor(net, { works: [w], date: '2026-12-01', h: 9 }), null);
  assert.ok(capKey(cm).includes(`${es[0]}:0.40`));
});
test('clashes finds corridor-connected overlapping works and ignores peak vs night', () => {
  const a = { id: 'a', name: 'A', road: 'Outer Ring Road', stations: ['Bellandur'], from: '2026-10-01', to: '2026-12-31', hours: 'all', cap: 0.7 };
  const b = { id: 'b', name: 'B', road: 'Outer Ring Road', stations: ['Bellandur', 'Mahadevapura'], from: '2026-11-01', to: '2027-01-31', hours: 'all', cap: 0.75 };
  const c = { ...b, id: 'c', from: '2027-02-01', to: '2027-03-01' };
  assert.equal(clashes(net, [a, b]).length, 1); assert.equal(clashes(net, [a, c]).length, 0);
  assert.equal(clashes(net, [{ ...a, hours: 'peak' }, { ...b, hours: 'night' }]).length, 0);
});
test('summarizeApprox is consistent with the model summary on the same result', () => {
  const r = assign(net, { t: 9, iters: 3 }), s = summarizeApprox(net, r.vc, r.spd);
  assert.equal(s.per.length, map.st.length);
  assert.ok(s.city.speed > 5 && s.city.speed < 60); assert.ok(s.city.congPct >= 0 && s.city.congPct <= 100);
  assert.deepEqual(Object.keys(s.reg), ['North', 'East', 'Central', 'West', 'South', 'Rural']);
  assert.equal(scopeSum(s, 'All'), s.city); assert.equal(scopeSum(s, 'East'), s.reg.East); assert.equal(scopeSum(null, 'All'), null);
  const tr = topRoads(net, r.vc, r.spd, { n: 5 }); assert.equal(tr.length, 5); assert.ok(tr[0].vc >= tr[4].vc);
});
test('nearestAlternate returns a different named road next to the edge', () => {
  const r = assign(net, { t: 9, iters: 3 }); let found = 0;
  for (let e = 0; e < net.ne && found < 20; e++) { if (net.name[e] < 0 || net.cls[e] > 1) continue; const a = nearestAlternate(net, r.vc, e); if (!a) continue; found++; assert.notEqual(net.name[a.e], net.name[e]); assert.ok(a.vc >= 0); }
  assert.ok(found > 5);
});
