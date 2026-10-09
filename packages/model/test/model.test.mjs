import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../../mapdata/index.mjs';
import { createNetwork, assign, summarize, encodeState, decodeState, simIncidents, calibrate, wt } from '../src/index.mjs';

const net = createNetwork(loadMap());

test('network is built from the real map', () => {
  assert.equal(net.nc, 69);
  assert.ok(net.ne > 9000 && net.nn > 3000);
});
test('peak is slower than night, and flow is conserved-ish', () => {
  const pk = summarize(net, assign(net, { t: 9 })), nt = summarize(net, assign(net, { t: 3 }));
  assert.ok(pk.speed < nt.speed, `${pk.speed} < ${nt.speed}`);
  assert.ok(wt(9) > wt(3));
});
test('closing an arterial segment adds delay (cost never falls)', () => {
  const base = assign(net, { t: 9 });
  const cm = new Float32Array(net.ne).fill(1);
  const busiest = [...Array(net.ne).keys()].sort((x, y) => base.vc[y] - base.vc[x])[0];
  cm[busiest] = 0;
  const after = assign(net, { t: 9, capMul: cm });
  assert.ok(after.cost >= base.cost * 0.999);
});
test('state encoding round-trips within quantisation error', () => {
  const r = assign(net, { t: 18.5 }), enc = encodeState(r), dec = decodeState(enc);
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(dec.vc[i] - Math.min(2.55, r.vc[i])) < 0.011);
});
test('simulated incidents are deterministic per date', () => {
  assert.deepEqual(simIncidents(net, '2026-10-07'), simIncidents(net, '2026-10-07'));
  assert.notDeepEqual(simIncidents(net, '2026-10-07'), simIncidents(net, '2026-10-08'));
});
test('calibration moves demand towards observed travel times', () => {
  const r0 = assign(net, { t: 9 });
  const from = net.cen[0], to = net.cen[3];
  const free = assign(net, { t: 3, iters: 3 });
  const dummy = calibrate(net, 9, [{ from, to, observedMin: 1, freeMin: 1 }]);
  assert.ok(dummy.boost < 1.5); // an impossibly fast observation pushes demand down
  assert.ok(r0.cost > free.cost);
});
