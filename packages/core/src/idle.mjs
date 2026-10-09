/** Idle-aware feed: when nobody has used the app for `feed.idleAfterMin`, ticks slow to one per `feed.idleTickMin` and paid connectors are skipped. */
export const ACTIVITY_THROTTLE_MS = 120000;

/** Record that someone is using the app. Cheap: one write at most every ACTIVITY_THROTTLE_MS per process. */
export function createActivityTracker({ store, clock }) {
  let last = 0;
  return async function touch() {
    const now = clock.now(); if (now - last < ACTIVITY_THROTTLE_MS) return;
    last = now;
    try { await store.set('state', 'activity', { id: 'activity', lastSeenAt: now }); } catch { last = 0; }
  };
}

/** Idle means: the feature is on, activity has been recorded before, and the last activity is older than idleAfterMin. */
export function isIdle(settings, activity, now) {
  const m = settings?.feed?.idleAfterMin ?? 0;
  return m > 0 && !!activity?.lastSeenAt && now - activity.lastSeenAt > m * 60000;
}

/** Should this scheduled tick run? Always when active; when idle only if the last tick is older than idleTickMin (minus slack for scheduler jitter). */
export function idleTickDue(settings, meta, now) {
  if (!meta?.lastTickAt) return true;
  return now - meta.lastTickAt >= settings.feed.idleTickMin * 60000 - 120000;
}
