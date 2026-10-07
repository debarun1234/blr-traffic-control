import { deepMerge, isObj } from './util.mjs';
import { ROLES } from '@blr/shared';

/** Defaults. Model ids come from env overrides (AI_MODEL_T1..T3) and are editable at runtime; logic never names a model. */
export function defaultSettings(env = process.env) {
  return {
    feed: { mode: 'sim', tickMin: 10, staleAfterMin: 25 },
    workflow: { escalateAfterMin: 15, verifyAfterMin: 30 },
    ai: {
      enabled: true, dailyCallCap: 400, briefPerDay: 24,
      perUserDaily: { admin: 100, commissioner: 60, dcp: 30, station: 20, viewer: 0 },
      tiers: {
        t1: { enabled: true, model: env.AI_MODEL_T1 || 'gemini-2.5-flash-lite' },
        t2: { enabled: true, model: env.AI_MODEL_T2 || 'gemini-2.5-flash' },
        t3: { enabled: true, model: env.AI_MODEL_T3 || 'gemini-2.5-pro' },
      },
      maxOutputTokens: { t1: 300, t2: 500, t3: 900 },
      timeoutMs: { t1: 8000, t2: 15000, t3: 30000 },
      // USD per 1M tokens. Estimates only; edit to match current published pricing.
      prices: { t1: { inPerM: 0.1, outPerM: 0.4 }, t2: { inPerM: 0.3, outPerM: 2.5 }, t3: { inPerM: 1.25, outPerM: 10 } },
      killReason: '',
    },
    caps: { routesCallsPerDay: 500, tomtomCallsPerDay: 500 },
    maintenance: false,
  };
}

const B = () => ({ t: 'bool' });
const I = (min, max) => ({ t: 'int', min, max });
const N = (min, max) => ({ t: 'num', min, max });
const E = (...v) => ({ t: 'enum', v });
const S = (max, re) => ({ t: 'str', max, re });
const O = (props) => ({ t: 'obj', props });
const perRole = O(Object.fromEntries(ROLES.map((r) => [r, I(0, 100000)])));
const tier = O({ enabled: B(), model: S(100, /^[A-Za-z0-9._\-/]+$/) });
const tierNum = (a, b) => O({ t1: I(a, b), t2: I(a, b), t3: I(a, b) });
const price = O({ inPerM: N(0, 1000), outPerM: N(0, 1000) });
export const SCHEMA = O({
  feed: O({ mode: E('sim', 'live', 'blend'), tickMin: I(1, 60), staleAfterMin: I(5, 240) }),
  workflow: O({ escalateAfterMin: I(1, 240), verifyAfterMin: I(1, 480) }),
  ai: O({
    enabled: B(), dailyCallCap: I(0, 100000), briefPerDay: I(0, 1000), perUserDaily: perRole,
    tiers: O({ t1: tier, t2: tier, t3: tier }), maxOutputTokens: tierNum(16, 8192), timeoutMs: tierNum(1000, 120000),
    prices: O({ t1: price, t2: price, t3: price }), killReason: S(300),
  }),
  caps: O({ routesCallsPerDay: I(0, 1e6), tomtomCallsPerDay: I(0, 1e6) }),
  maintenance: B(),
});

function check(sch, v, path, errors) {
  switch (sch.t) {
    case 'bool': if (typeof v !== 'boolean') errors.push(`${path}: must be boolean`); break;
    case 'int': if (!Number.isInteger(v) || v < sch.min || v > sch.max) errors.push(`${path}: integer ${sch.min}..${sch.max}`); break;
    case 'num': if (typeof v !== 'number' || !Number.isFinite(v) || v < sch.min || v > sch.max) errors.push(`${path}: number ${sch.min}..${sch.max}`); break;
    case 'enum': if (!sch.v.includes(v)) errors.push(`${path}: one of ${sch.v.join('|')}`); break;
    case 'str': if (typeof v !== 'string' || v.length > sch.max || (sch.re && !sch.re.test(v))) errors.push(`${path}: invalid string`); break;
    case 'obj':
      if (!isObj(v)) { errors.push(`${path || 'settings'}: must be object`); break; }
      for (const k of Object.keys(v)) {
        if (!(k in sch.props)) errors.push(`${path ? path + '.' : ''}${k}: unknown key`);
        else check(sch.props[k], v[k], `${path ? path + '.' : ''}${k}`, errors);
      }
      break;
  }
}
/** Validate a (possibly partial) settings object. Unknown keys are errors. */
export function validateSettings(obj) { const errors = []; check(SCHEMA, obj, '', errors); return errors; }

/** Stored settings over defaults. Unknown stored keys are dropped silently on read. */
export async function getSettings(store, env = process.env) {
  const stored = (await store.get('settings', 'app')) ?? {};
  const strip = (sch, v) => (sch.t === 'obj' && isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k in sch.props).map(([k, x]) => [k, strip(sch.props[k], x)])) : v);
  return deepMerge(defaultSettings(env), strip(SCHEMA, stored));
}
/** Merge `patch` into current settings, validate the patch and the result, persist. Returns {settings, errors}. */
export async function putSettings(store, patch, env = process.env) {
  const errors = validateSettings(patch);
  if (errors.length) return { errors };
  const next = deepMerge(await getSettings(store, env), patch);
  const e2 = validateSettings(next);
  if (e2.length) return { errors: e2 };
  await store.set('settings', 'app', next);
  return { settings: next, errors: [] };
}
