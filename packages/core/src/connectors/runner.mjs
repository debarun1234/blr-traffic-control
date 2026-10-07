import { err } from '../errors.mjs';
import { redact, rid } from '../util.mjs';
import { getSettings } from '../settings.mjs';
import { createAudit } from '../audit.mjs';
import { REGISTRY, CONNECTOR_TYPES, PAID } from './types.mjs';
import { createSafeFetch } from './ssrf.mjs';

export const MAX_FAILURES = 3;

/** Validate connector input (create/patch merged). Returns array of problems. */
export function validateConnector(c) {
  const e = [], t = REGISTRY[c.type];
  if (!t) return [`type must be one of ${CONNECTOR_TYPES.join(', ')}`];
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 80) e.push('name required (max 80)');
  if (!Number.isInteger(c.intervalMin) || c.intervalMin < 1 || c.intervalMin > 1440) e.push('intervalMin must be 1..1440');
  if (typeof c.enabled !== 'boolean') e.push('enabled must be boolean');
  if (!['live', 'shadow'].includes(c.mode)) e.push('mode must be live|shadow');
  if (c.dailyCap !== undefined && !(Number.isInteger(c.dailyCap) && c.dailyCap >= 1 && c.dailyCap <= 1e6)) e.push('dailyCap must be a positive integer');
  if (c.secretRef !== undefined && !/^[A-Za-z0-9_-]{1,255}$/.test(c.secretRef)) e.push('secretRef must be a Secret Manager secret name');
  if (t.needsSecret && !c.secretRef) e.push('secretRef required for this type');
  if (c.config === null || typeof c.config !== 'object' || Array.isArray(c.config)) e.push('config must be an object');
  else e.push(...t.validateConfig(c.config));
  return e;
}

/**
 * @param {{store:any, net:any, clock:{now():number}, fetch?:Function, secretReader?:(ref:string)=>Promise<string>, resolve?:Function, production?:boolean, env?:object}} o
 */
export function createConnectorRunner({ store, net, clock, fetch = globalThis.fetch, secretReader, resolve, production = process.env.NODE_ENV === 'production' }) {
  const safeFetch = createSafeFetch({ fetch, resolve, production });
  const audit = createAudit({ store, clock });
  const ctxFor = async (now) => ({ store, net, clock, fetch: safeFetch, secretReader, settings: await getSettings(store), now });

  async function record(c, now, ok, ms, count, error, cost, extra = {}) {
    const run = { id: `${now}-${rid(3)}`, connectorId: c.id, at: now, ok, ms, count, ...(error ? { error } : {}), ...(cost ? { cost } : {}), ...extra, expireAt: now + 14 * 86400000 };
    await store.set('connector_runs', run.id, run);
    const lastRun = { at: now, ok, ms, count, ...(error ? { error } : {}) };
    let tripped = false;
    await store.update('connectors', c.id, (cur) => {
      if (!cur) return undefined;
      const failures = ok ? 0 : (cur.failures ?? 0) + 1;
      const next = { ...cur, lastRun, failures };
      if (!ok && failures >= MAX_FAILURES && cur.enabled) { next.enabled = false; next.disabledReason = `circuit breaker: ${failures} consecutive failures`; tripped = true; }
      return next;
    });
    if (tripped) await audit.write({ actor: 'system', kind: 'connector_autodisable', target: c.id, summary: `Connector ${c.name} auto-disabled after ${MAX_FAILURES} consecutive failures`, meta: { error } });
    return run;
  }

  async function runOne(c, { now = clock.now() } = {}) {
    const t0 = performance.now(), ctx = await ctxFor(now);
    try {
      const out = await REGISTRY[c.type].run(c, ctx);
      return await record(c, now, true, Math.round(performance.now() - t0), out.count, null, out.cost, out.shadow ? { shadow: true } : {});
    } catch (e) {
      const msg = redact(e?.message ?? String(e), [ctx.secret]).slice(0, 300);
      return record(c, now, false, Math.round(performance.now() - t0), 0, msg);
    }
  }
  return {
    validate: validateConnector,
    /** Dry run: never writes state. */
    async test(c) {
      const t0 = performance.now(), ctx = await ctxFor(clock.now());
      try { const r = await REGISTRY[c.type].test(c, ctx); return { ok: true, sample: r.sample, ms: Math.round(performance.now() - t0), count: r.count, rejected: r.rejected, cost: r.cost, note: r.note }; }
      catch (e) { return { ok: false, sample: [], ms: Math.round(performance.now() - t0), error: redact(e?.message ?? e, [ctx.secret]).slice(0, 300) }; }
    },
    runNow: async (id, o) => { const c = await store.get('connectors', id); if (!c) throw err('not_found', 'connector'); return runOne(c, o); },
    /** Run enabled connectors whose interval has elapsed. */
    async runDue({ now = clock.now() } = {}) {
      const out = [];
      for (const c of await store.list('connectors', { where: [['enabled', '==', true]] })) {
        if (c.type === 'sim' || c.type === 'webhook') continue;
        if (c.lastRun && now - c.lastRun.at < c.intervalMin * 60000) continue;
        const r = await runOne(c, { now }); out.push({ id: c.id, ok: r.ok, count: r.count, error: r.error });
      }
      return out;
    },
    paidTypes: PAID,
  };
}
