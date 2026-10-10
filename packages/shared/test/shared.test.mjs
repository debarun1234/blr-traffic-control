import test from 'node:test';
import assert from 'node:assert/strict';
import { jurisdiction, hasPermission, canOnStation, lockedRegion, validateUser, canTransition, istParts } from '../src/index.mjs';

const stations = [{ n: 'Yelahanka', r: 'North' }, { n: 'Hebbal', r: 'North' }, { n: 'Indiranagar', r: 'East' }];
test('jurisdiction by role', () => {
  assert.equal(jurisdiction({ role: 'commissioner' }, stations).size, 3);
  assert.deepEqual([...jurisdiction({ role: 'dcp', region: 'North' }, stations)].sort(), ['Hebbal', 'Yelahanka']);
  assert.deepEqual([...jurisdiction({ role: 'station', station: 'Indiranagar' }, stations)], ['Indiranagar']);
  assert.equal(jurisdiction({ role: 'viewer' }, stations).size, 0);
  assert.equal(jurisdiction({ role: 'admin', active: false }, stations).size, 0);
});
test('permissions', () => {
  assert.ok(hasPermission({ role: 'admin' }, 'admin.access'));
  assert.ok(!hasPermission({ role: 'commissioner' }, 'admin.access'));
  assert.ok(!hasPermission({ role: 'station', station: 'x' }, 'works.write'));
  assert.ok(canOnStation({ role: 'station', station: 'Yelahanka' }, 'action.transition', 'Yelahanka', stations));
  assert.ok(!canOnStation({ role: 'station', station: 'Yelahanka' }, 'action.transition', 'Hebbal', stations));
});
test('region lock', () => {
  assert.equal(lockedRegion({ role: 'station', station: 'Indiranagar' }, stations), 'East');
  assert.equal(lockedRegion({ role: 'commissioner' }, stations), null);
});
test('validateUser', () => {
  assert.deepEqual(validateUser({ email: 'a@b.co', role: 'dcp', region: 'North' }, stations), []);
  assert.deepEqual(validateUser({ email: 'bad', role: 'dcp' }, stations), ['email', 'region']);
});
test('workflow', () => {
  assert.ok(canTransition('new', 'ack'));
  assert.ok(!canTransition('new', 'done'));
  assert.ok(!canTransition('cleared', 'prog'));
});
test('IST', () => { assert.deepEqual(istParts(Date.UTC(2026, 9, 7, 0, 0, 0)), { date: '2026-10-07', h: 5.5 }); });

test('renamed station: the old spelling Yalahanka still resolves to Yelahanka for stored users and records', async () => {
  const { jurisdiction, canOnStation, canonStation } = await import('../src/index.mjs');
  const st = [{ n: 'Yelahanka', r: 'North' }, { n: 'Hebbal', r: 'North' }];
  assert.equal(canonStation('Yalahanka'), 'Yelahanka');
  assert.deepEqual([...jurisdiction({ role: 'station', station: 'Yalahanka' }, st)], ['Yelahanka']);
  assert.ok(canOnStation({ role: 'station', station: 'Yelahanka' }, 'action.transition', 'Yalahanka', st));
});
