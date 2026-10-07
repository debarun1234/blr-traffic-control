import { hasPermission } from '@blr/shared';
import { err } from '../errors.mjs';
import { getSettings } from '../settings.mjs';
import { sha256, stable, istDay, istHourKey, nextIstMidnight } from '../util.mjs';
import { cleanContext, buildPrompt, sanitiseOutput } from './prompts.mjs';
import { adviceTemplate } from './templates.mjs';

export const KINDS = ['action_advice', 'translate_kn', 'works_clash'];
const CACHE_TTL = 24 * 3600000, SMALL_CONTEXT = 400;
export const emptyUsage = (date) => ({ date, calls: 0, tokensIn: 0, tokensOut: 0, byTier: { t0: 0, t1: 0, t2: 0, t3: 0 }, byUser: {}, byKind: {}, cacheHits: 0, estCostUsd: 0, costNote: 'estimate: tokens x price table in settings' });
const est = (s) => Math.ceil(String(s ?? '').length / 4);

/** Map a request to a tier. Small action contexts are answered by templates without a model. */
export function routeTask(kind, ctx = {}) {
  if (kind === 'action_advice') return !ctx.question && JSON.stringify(ctx).length <= SMALL_CONTEXT ? 't0' : 't2';
  if (kind === 'translate_kn') return 't1';
  if (kind === 'works_clash') return 't2';
  if (kind === 'brief') return 't3';
  throw err('invalid', 'Unknown AI task');
}

/** @param {{store:any, clock:{now():number}, generate:(o:{model:string,prompt:string,maxOutputTokens:number,signal?:AbortSignal})=>Promise<string|{text:string,tokensIn?:number,tokensOut?:number}>, env?:object}} o */
export function createAiRouter({ store, clock, generate, env = process.env }) {
  const usageDoc = async (now) => (await store.get('ai_usage', istDay(now))) ?? emptyUsage(istDay(now));
  const bump = (now, f) => store.update('ai_usage', istDay(now), (cur) => { const u = cur ?? emptyUsage(istDay(now)); f(u); return u; });

  async function run({ user, kind, ctx, scope }) {
    const now = clock.now(), s = await getSettings(store, env);
    if (s.maintenance) throw err('unavailable', 'Service is in maintenance mode');
    const tier = routeTask(kind, ctx);
    const model = tier === 't0' ? null : s.ai.tiers[tier].model;
    const tierOn = tier === 't0' || (s.ai.enabled && s.ai.tiers[tier].enabled);
    if (!tierOn && !(kind === 'action_advice')) throw err('unavailable', s.ai.enabled ? `AI tier ${tier} is disabled` : `AI is disabled${s.ai.killReason ? `: ${s.ai.killReason}` : ''}`);
    if (!hasPermission(user, kind === 'brief' ? 'ai.brief' : 'ai.advise')) throw err('forbidden', 'Role may not use this AI feature');
    const effTier = tierOn ? tier : 't0';
    if (effTier === 't0') {
      await bump(now, (u) => { u.byTier.t0++; });
      return { text: adviceTemplate(ctx), tier: 't0', cached: false };
    }
    const u0 = await usageDoc(now);
    const limit = s.ai.perUserDaily[user.role] ?? 0;
    if ((u0.byUser[user.email] ?? 0) >= limit) throw err('quota_exceeded', 'Daily AI quota used up for your role');
    if (u0.calls >= s.ai.dailyCallCap) throw err('quota_exceeded', 'Daily AI budget for the whole system is used up');
    if (kind === 'brief' && (u0.byKind.brief ?? 0) >= s.ai.briefPerDay) throw err('quota_exceeded', 'Daily brief limit reached');
    const key = sha256(kind === 'brief' ? `t3|brief|${scope}|${istHourKey(now)}` : `${effTier}|${kind}|${stable(ctx)}`);
    const hit = await store.get('ai_cache', key);
    if (hit && hit.expireAt > now) { await bump(now, (u) => { u.cacheHits++; }); return { text: hit.text, tier: effTier, cached: true, model: hit.model, generatedAt: hit.createdAt }; }
    const maxOutputTokens = s.ai.maxOutputTokens[effTier], prompt = buildPrompt(kind, ctx);
    const ac = new AbortController(); let timer;
    let out;
    try {
      out = await Promise.race([generate({ model, prompt, maxOutputTokens, signal: ac.signal }), new Promise((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error('timeout')); }, s.ai.timeoutMs[effTier]); })]);
    } catch (e) { throw err('unavailable', e?.message === 'timeout' ? 'AI request timed out' : 'AI service error'); } finally { clearTimeout(timer); }
    const raw = typeof out === 'string' ? out : out?.text, text = sanitiseOutput(raw, kind === 'brief' ? 3000 : 1800);
    if (!text) throw err('unavailable', 'AI returned no text');
    const tin = out?.tokensIn ?? est(prompt), tout = out?.tokensOut ?? est(raw), price = s.ai.prices[effTier] ?? { inPerM: 0, outPerM: 0 };
    const cost = (tin * price.inPerM + tout * price.outPerM) / 1e6;
    await bump(now, (u) => { u.calls++; u.tokensIn += tin; u.tokensOut += tout; u.byTier[effTier]++; u.byUser[user.email] = (u.byUser[user.email] ?? 0) + 1; u.byKind[kind] = (u.byKind[kind] ?? 0) + 1; u.estCostUsd = Math.round((u.estCostUsd + cost) * 1e6) / 1e6; });
    await store.set('ai_cache', key, { key, tier: effTier, text, model, createdAt: now, expireAt: now + CACHE_TTL });
    return { text, tier: effTier, cached: false, model, generatedAt: now };
  }

  return {
    routeTask,
    /** @param {{user:object, kind:string, context:object}} p */
    async advise({ user, kind, context }) {
      if (!KINDS.includes(kind)) throw err('invalid', `kind must be one of ${KINDS.join(', ')}`);
      const ctx = cleanContext(kind, context);
      if (kind === 'translate_kn' && !ctx.text) throw err('invalid', 'context.text required');
      const r = await run({ user, kind, ctx });
      return { text: r.text, tier: r.tier, cached: r.cached, ...(r.model ? { model: r.model } : {}) };
    },
    /** @param {{user:object, scope:string, context:object}} p context is built server-side (see briefContext) */
    async brief({ user, scope, context }) {
      const r = await run({ user, kind: 'brief', ctx: cleanContext('brief', context), scope });
      return { text: r.text, tier: 't3', cached: r.cached, generatedAt: r.generatedAt ?? clock.now() };
    },
    async quota(user) {
      const now = clock.now(), s = await getSettings(store, env), u = await usageDoc(now);
      return { used: u.byUser[user.email] ?? 0, limit: s.ai.perUserDaily[user.role] ?? 0, resetsAt: nextIstMidnight(now), aiEnabled: s.ai.enabled && !s.maintenance };
    },
  };
}
