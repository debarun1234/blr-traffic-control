import test from 'node:test';
import assert from 'node:assert/strict';

/** Shared behaviour every Store implementation must satisfy. */
export function runConformance(name, make) {
  test(`${name}: get/set/delete round-trip, undefined dropped, copies not aliased`, async () => {
    const s = make();
    assert.equal(await s.get('c', 'x'), null);
    const doc = { a: 1, n: { b: 2, u: undefined }, arr: [1, 2] };
    await s.set('c', 'x', doc);
    doc.a = 99;
    const got = await s.get('c', 'x');
    assert.deepEqual(got, { a: 1, n: { b: 2 }, arr: [1, 2] });
    got.a = 5; assert.equal((await s.get('c', 'x')).a, 1);
    await s.delete('c', 'x'); assert.equal(await s.get('c', 'x'), null);
  });
  test(`${name}: update patch is shallow merge and throws not_found; fn form is atomic create-if-absent`, async () => {
    const s = make();
    await assert.rejects(s.update('c', 'm', { a: 1 }), { code: 'not_found' });
    await s.set('c', 'm', { a: 1, n: { x: 1, y: 2 }, drop: 1 });
    const r = await s.update('c', 'm', { n: { x: 9 }, drop: undefined, z: 3 });
    assert.deepEqual(r, { a: 1, n: { x: 9 }, z: 3 });
    let made = 0;
    for (let i = 0; i < 2; i++) await s.update('c', 'new', (cur) => { if (cur) return undefined; made++; return { id: 'new', v: 1 }; });
    assert.equal(made, 1);
    const inc = await s.update('c', 'new', (cur) => ({ ...cur, v: cur.v + 1 }));
    assert.equal(inc.v, 2);
  });
  test(`${name}: list where/orderBy/limit and operators`, async () => {
    const s = make();
    for (let i = 1; i <= 6; i++) await s.set('l', `d${i}`, { id: `d${i}`, n: i, g: i % 2 ? 'odd' : 'even', tags: i > 3 ? ['hi'] : ['lo'] });
    await s.set('l', 'nofield', { id: 'nofield', g: 'odd' });
    assert.deepEqual((await s.list('l', { where: [['g', '==', 'even']], orderBy: 'n' })).map((d) => d.n), [2, 4, 6]);
    assert.deepEqual((await s.list('l', { where: [['n', '>=', 2], ['n', '<', 5]], orderBy: ['n', 'desc'] })).map((d) => d.n), [4, 3, 2]);
    assert.deepEqual((await s.list('l', { where: [['n', 'in', [1, 6, 7]]], orderBy: 'n' })).map((d) => d.n), [1, 6]);
    assert.deepEqual((await s.list('l', { where: [['tags', 'array-contains', 'hi']], orderBy: 'n', limit: 2 })).map((d) => d.n), [4, 5]);
    assert.equal((await s.list('l', { where: [['g', '!=', 'odd']] })).length, 3);
    assert.equal((await s.list('l', { orderBy: 'n' })).length, 6, 'orderBy excludes docs missing the field');
    assert.equal((await s.list('empty')).length, 0);
  });
  test(`${name}: add generates id; batch applies set/update/delete atomically`, async () => {
    const s = make();
    const a = await s.add('a', { v: 1 }); assert.ok(a.id); assert.deepEqual(await s.get('a', a.id), { v: 1, id: a.id });
    const b = await s.add('a', { id: 'fixed', v: 2 }); assert.equal(b.id, 'fixed');
    await s.batch([{ op: 'set', col: 'b', id: '1', data: { id: '1', v: 1 } }, { op: 'update', col: 'a', id: 'fixed', data: { v: 3 } }, { op: 'delete', col: 'a', id: a.id }]);
    assert.equal((await s.get('b', '1')).v, 1); assert.equal((await s.get('a', 'fixed')).v, 3); assert.equal(await s.get('a', a.id), null);
    await assert.rejects(s.batch([{ op: 'set', col: 'b', id: '2', data: { id: '2' } }, { op: 'update', col: 'b', id: 'missing', data: { v: 1 } }]), { code: 'not_found' });
    assert.equal(await s.get('b', '2'), null, 'failed batch leaves no partial writes');
  });
  test(`${name}: expireAt is epoch ms on read and queryable`, async () => {
    const s = make();
    await s.set('t', 'old', { id: 'old', expireAt: 1000 }); await s.set('t', 'new', { id: 'new', expireAt: 9e12 });
    assert.equal((await s.get('t', 'old')).expireAt, 1000);
    assert.deepEqual((await s.list('t', { where: [['expireAt', '<', 5000]] })).map((d) => d.id), ['old']);
  });
}
