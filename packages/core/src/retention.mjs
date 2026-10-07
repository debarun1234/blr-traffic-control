export const TTL_COLLECTIONS = ['state_hist', 'probe_obs', 'ai_cache', 'connector_runs', 'counters'];
/** Delete docs whose `expireAt` has passed (what a Firestore TTL policy would do; also works for the memory store). */
export async function runRetention({ store, now }) {
  const deleted = {};
  for (const col of TTL_COLLECTIONS) {
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const docs = await store.list(col, { where: [['expireAt', '<', now]], limit: 400 });
      if (!docs.length) break;
      await store.batch(docs.map((d) => ({ op: 'delete', col, id: d.id ?? d.key })));
      n += docs.length; if (docs.length < 400) break;
    }
    deleted[col] = n;
  }
  return { deleted };
}
