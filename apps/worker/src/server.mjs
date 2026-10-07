import Fastify from 'fastify';
import * as F from 'fastify';
import { ApiError, err, systemClock, getNet, createConnectorRunner, runTick, runChecks, applyBudget, parseBudgetMessage, runRetention, httpTimeSource, assertAuthConfig } from '@blr/core';

/** Google OIDC verifier (google-auth-library, lazy). Returns async (idToken) => payload. */
export function createOidcVerifier({ audience } = {}) {
  let client;
  return async (token) => {
    if (!client) { const { OAuth2Client } = await import('google-auth-library'); client = new OAuth2Client(); }
    const ticket = await client.verifyIdToken({ idToken: token, ...(audience ? { audience } : {}) });
    return ticket.getPayload();
  };
}

/** Fastify >=5.12 deprecates the top-level `disableRequestLogging`; use a LogController when available. */
export function quietRequests() {
  const LC = F.LogController;
  return LC ? { logController: new (class extends LC { constructor() { super({ disableRequestLogging: true }); } })() } : { disableRequestLogging: true };
}

/**
 * Private worker. `/internal/*` requires a Google OIDC token whose email equals INTERNAL_INVOKER_SA.
 * @param {{store:any, verifier?:(t:string)=>Promise<{email?:string,email_verified?:boolean}>, clock?:any, net?:any, fetch?:Function, secretReader?:Function, env?:object, logger?:any, resolve?:Function, timeSource?:Function}} o
 */
export async function buildWorker(o) {
  const env = o.env ?? process.env, clock = o.clock ?? systemClock, net = o.net ?? getNet(), store = o.store;
  assertAuthConfig(env);
  const connectors = createConnectorRunner({ store, net, clock, fetch: o.fetch, secretReader: o.secretReader, resolve: o.resolve, production: env.NODE_ENV === 'production' });
  const app = Fastify({ logger: o.logger ?? { level: env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization'] }, ...quietRequests(), bodyLimit: 256 * 1024 });
  // Tolerate empty JSON bodies (Cloud Scheduler).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, text, done) => { if (!text) return done(null, undefined); try { done(null, JSON.parse(text)); } catch { done(Object.assign(new Error('Malformed JSON'), { statusCode: 400 })); } });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ApiError) return reply.status(e.status).send({ error: { code: e.code, message: e.message } });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: 'invalid', message: 'Malformed request' } });
    req.log.error({ err: { message: e.message, stack: e.stack } }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'unavailable', message: 'Internal error' } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (req, reply) => { try { await store.get('settings', 'app'); return { ok: true, store: 'ok' }; } catch { return reply.status(503).send({ ok: false, store: 'error' }); } });

  await app.register(async (internal) => {
    internal.addHook('preHandler', async (req) => {
      const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''));
      if (!m || !o.verifier) throw err('unauthenticated', 'Missing credentials');
      let p; try { p = await o.verifier(m[1]); } catch { throw err('unauthenticated', 'Invalid token'); }
      const want = String(env.INTERNAL_INVOKER_SA ?? '').toLowerCase();
      if (!want || String(p?.email ?? '').toLowerCase() !== want || p.email_verified === false) throw err('forbidden', 'Caller is not the configured invoker');
    });
    let ticking = false;
    internal.post('/tick', async () => {
      if (ticking) return { ok: true, skipped: 'tick already running' };
      ticking = true;
      try { return await runTick({ store, net, now: clock.now(), connectors }); } finally { ticking = false; }
    });
    internal.post('/checks', async () => runChecks({ store, net, clock, env, timeSource: o.timeSource ?? (o.fetch ? undefined : httpTimeSource()) }));
    internal.post('/budget', async (req) => {
      const msg = parseBudgetMessage(req.body);
      if (!msg) throw err('invalid', 'Unrecognised budget notification');
      return { ok: true, ...(await applyBudget({ store, clock }, msg)) };
    });
    internal.post('/retention', async () => ({ ok: true, ...(await runRetention({ store, now: clock.now() })) }));
  }, { prefix: '/internal' });
  return app;
}
