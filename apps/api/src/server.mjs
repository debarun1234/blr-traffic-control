import Fastify from 'fastify';
import * as F from 'fastify';
import { createHash } from 'node:crypto';
import { ApiError, err, systemClock, getNet, createAudit, createAuthenticator, assertAuthConfig, createConnectorRunner, createRateLimiter, getSettings, httpTimeSource } from '@blr/core';
import { registerOps } from './routes/ops.mjs';
import { registerAdmin } from './routes/admin.mjs';
import { registerIngest } from './routes/ingest.mjs';

/** Fastify >=5.12 deprecates the top-level `disableRequestLogging`; use a LogController when available. */
export function quietRequests() {
  const LC = F.LogController;
  return LC ? { logController: new (class extends LC { constructor() { super({ disableRequestLogging: true }); } })() } : { disableRequestLogging: true };
}

/**
 * @param {{store:any, verifier?:Function, clock?:{now():number}, ai?:any, secretReader?:Function, fetch?:Function, env?:object, net?:any,
 *          logger?:any, resolve?:Function, timeSource?:Function, rateLimit?:{perMinute?:number, ingestPerMinute?:number, aiPerMinute?:number}}} o
 */
export async function buildServer(o) {
  const env = o.env ?? process.env, clock = o.clock ?? systemClock, net = o.net ?? getNet(), store = o.store;
  assertAuthConfig(env);
  const production = env.NODE_ENV === 'production';
  const app = Fastify({
    logger: o.logger ?? { level: env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers.cookie'] },
    ...quietRequests(), trustProxy: true, bodyLimit: 256 * 1024, requestIdHeader: 'x-request-id',
  });
  const audit = createAudit({ store, clock });
  const auth = createAuthenticator({ store, clock, env, verifier: o.verifier });
  const connectors = createConnectorRunner({ store, net, clock, fetch: o.fetch, secretReader: o.secretReader, resolve: o.resolve, production });
  const limiter = createRateLimiter({ clock });
  const rl = { perMinute: 600, ingestPerMinute: 300, aiPerMinute: 20, ...(o.rateLimit ?? {}) };
  const ctx = { app, store, net, clock, env, audit, auth, connectors, ai: o.ai ?? null, limiter, rl, timeSource: o.timeSource ?? (o.fetch ? undefined : httpTimeSource()), secretReader: o.secretReader };
  app.decorate('ctx', ctx);

  // JSON parser that tolerates empty bodies (schedulers and DELETE calls often send content-type: application/json with no body).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, text, done) => {
    if (!text) return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch { done(Object.assign(new Error('Malformed JSON'), { statusCode: 400 })); }
  });

  app.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (req, text, done) => done(null, text));
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (req, text, done) => done(null, text));

  app.addHook('onRequest', async (req, reply) => {
    req.startedAt = performance.now();
    reply.header('x-content-type-options', 'nosniff').header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer')
      .header('cross-origin-opener-policy', 'same-origin').header('cross-origin-resource-policy', 'same-origin')
      .header('permissions-policy', 'geolocation=(), camera=(), microphone=()').header('x-request-id', req.id);
    if (production) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    const p = req.url.split('?')[0];
    if (p.startsWith('/api/') || p.startsWith('/ingest/')) reply.header('cache-control', 'no-store');
    if (p === '/healthz' || p === '/readyz') return;
    const lim = p.startsWith('/ingest/') ? rl.ingestPerMinute : rl.perMinute;
    const r = limiter.hit(`ip:${p.startsWith('/ingest/') ? 'i' : 'a'}:${req.ip}`, lim);
    if (!r.ok) { reply.header('retry-after', String(r.retryAfterSec)); throw err('rate_limited', 'Too many requests'); }
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.url === '/healthz' || req.url === '/readyz') return;
    req.log.info({ method: req.method, path: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(performance.now() - req.startedAt), user: req.user?.email, key: req.keyPrefix }, 'request');
  });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ApiError) {
      if (e.code === 'rate_limited' && e.extra?.retryAfterSec) reply.header('retry-after', String(e.extra.retryAfterSec));
      return reply.status(e.status).send({ error: { code: e.code, message: e.message } });
    }
    if (e.statusCode === 413) return reply.status(413).send({ error: { code: 'invalid', message: 'Request body too large' } });
    if (e.statusCode === 415) return reply.status(415).send({ error: { code: 'invalid', message: 'Unsupported content type' } });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: 'invalid', message: 'Malformed request' } });
    req.log.error({ err: { message: e.message, stack: e.stack } }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'unavailable', message: 'Internal error' } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/healthz', async () => ({ ok: true }));
  const ready = async (req, reply) => { try { await store.get('settings', 'app'); return { ok: true, store: 'ok' }; } catch { return reply.status(503).send({ ok: false, store: 'error' }); } };
  app.get('/readyz', ready); app.get('/api/readyz', ready);

  await app.register(async (api) => {
    api.addHook('preHandler', async (req) => {
      if (req.url.split('?')[0].endsWith('/healthz') || req.url.split('?')[0].endsWith('/readyz')) return;
      req.user = await auth.verifyRequest(req.headers);
    });
    registerOps(api, ctx); registerAdmin(api, ctx);
  }, { prefix: '/api' });
  await app.register(async (ing) => registerIngest(ing, ctx), { prefix: '/ingest/v1' });

  ctx.etag = (doc) => `W/"${createHash('sha1').update(`${doc.updatedAt}|${doc.stale}|${doc.mode}`).digest('hex').slice(0, 16)}"`;
  ctx.settings = () => getSettings(store, env);
  return app;
}
