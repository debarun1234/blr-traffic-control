import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createFirestoreStore } from '../src/index.mjs';
import { createFakeFirestore } from '../src/testing.mjs';
import { runConformance } from './store.conformance.mjs';

runConformance('memory', () => createMemoryStore());
runConformance('firestore(fake)', () => createFirestoreStore(createFakeFirestore()));

test('firestore store writes expireAt as Date (TTL) and never writes undefined', async () => {
  const db = createFakeFirestore(), s = createFirestoreStore(db);
  await s.set('t', 'a', { id: 'a', expireAt: 12345, nested: { u: undefined, k: 1 } });
  const raw = db._data.get('t/a');
  assert.ok(raw.expireAt instanceof Date); assert.equal(raw.expireAt.getTime(), 12345);
  assert.ok(!('u' in raw.nested));
});
