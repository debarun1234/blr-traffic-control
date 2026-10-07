/** Fixed-window in-memory rate limiter (per process). `hit(key, limit, windowMs)`. */
export function createRateLimiter({ clock, windowMs = 60000 } = {}) {
  const m = new Map(); let last = 0;
  return {
    hit(key, limit, win = windowMs) {
      const now = clock.now();
      if (now - last > win) { last = now; for (const [k, v] of m) if (v.reset <= now) m.delete(k); }
      let e = m.get(key); if (!e || e.reset <= now) { e = { n: 0, reset: now + win }; m.set(key, e); }
      e.n++;
      return { ok: e.n <= limit, remaining: Math.max(0, limit - e.n), retryAfterSec: Math.ceil((e.reset - now) / 1000) };
    },
  };
}
