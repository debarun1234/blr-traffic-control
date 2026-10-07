import { authIngest, ingestEvents, ingestSpeeds, ingestWorks, MAX_BATCH } from '@blr/core';
import { bad, body, only } from '../http.mjs';

export function registerIngest(api, ctx) {
  const { store, net, clock, limiter } = ctx;
  const arr = (b, k) => { only(b, [k]); if (!Array.isArray(b[k])) bad(`${k} must be an array`); if (b[k].length > MAX_BATCH) bad(`at most ${MAX_BATCH} ${k} per request`); return b[k]; };
  const route = (path, scope, fn) => api.post(path, async (req) => {
    const key = await authIngest({ store, limiter, clock }, req.headers, scope);
    req.keyPrefix = key.prefix;
    return fn(key, body(req));
  });
  route('/events', 'events', (key, b) => ingestEvents({ store, net, now: clock.now() }, key, arr(b, 'events')));
  route('/speeds', 'speeds', (key, b) => ingestSpeeds({ store, now: clock.now() }, arr(b, 'observations')));
  route('/works', 'works', (key, b) => ingestWorks({ store, net, now: clock.now() }, key, arr(b, 'works')));
}

