import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT, KEYS, t, setI18nLang, typeName, regionName, agoText } from '../src/i18n.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : []; });

test('every key has a non-empty English and Kannada string with matching placeholders', () => {
  for (const k of KEYS) {
    const [en, kn] = DICT[k];
    assert.ok(en && en.trim(), `EN empty: ${k}`); assert.ok(kn && kn.trim(), `KN empty: ${k}`);
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph(en), ph(kn), `placeholder mismatch: ${k}`);
    assert.ok(/[ಀ-೿]/.test(kn) || /^[\w\s/.%()·–-]+$/.test(kn), `KN has no Kannada script: ${k}`);
  }
});
test('every literal t("key") used in the source exists in the dictionary', () => {
  const missing = new Set();
  for (const f of walk(SRC)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\bt\('([^']+)'/g)) if (!DICT[m[1]]) missing.add(`${m[1]} (${f.replace(SRC, '')})`);
  }
  assert.deepEqual([...missing], []);
});
test('dynamic key families are fully covered', () => {
  const fam = {
    'state.': ['new', 'ack', 'prog', 'done', 'cleared', 'persist'], 'mode.': ['live.long', 'sim.long', 'blend.long'], 'cls.': ['arterial', 'subArterial', 'collector'],
    'win.': ['peakAM', 'mid', 'peakPM', 'night'], 'wk.hours.': ['all', 'peak', 'night'], 'wk.kind.': ['Metro', 'Drain', 'Bridge', 'Road', 'Utility', 'Other'], 'wk.src.': ['csv', 'connector', 'ingest', 'manual'],
    'src.': ['sim', 'user', 'connector', 'ingest'], 'ai.tierHint.': ['t0', 't1', 't2', 't3'], 'ai.tier.': ['t0', 't1', 't2', 't3'], 'signin.scope.': ['admin', 'commissioner', 'dcp', 'station', 'viewer'],
    'act.f.': ['open', 'all'], 'layers.': ['minor', 'stn', 'inc', 'works', 'gtraffic'], 'view.': ['traffic.t', 'traffic.d', 'traffic.use', 'safety.t', 'safety.d', 'safety.use', 'speed.t', 'speed.d', 'speed.use'], 'tab.': ['overview', 'station', 'actions', 'planner', 'works'], 'role.': ['admin', 'commissioner', 'dcp', 'station', 'viewer'], 'reg.': ['North', 'East', 'Central', 'West', 'South'],
    'plan.': ['close', 'half'], 'act.': ['ack', 'start', 'done', 'reopen', 'resume'], 'ago.': ['s', 'm', 'h', 'd'], 'kbd.': ['scope1', 'scope26', 'search', 'zoom', 'replay', 'esc', 'help'], 'legend.': ['free', 'light', 'busy', 'slow', 'jam', 'grid'],
  };
  for (const [p, xs] of Object.entries(fam)) for (const x of xs) assert.ok(DICT[p + x], `missing ${p}${x}`);
});
test('t() interpolates, switches language and falls back to the key', () => {
  setI18nLang('en'); assert.equal(t('pill.stale', { time: '08:20' }), 'STALE since 08:20'); assert.equal(t('nope.key'), 'nope.key');
  setI18nLang('kn'); assert.match(t('tab.overview'), /[ಀ-೿]/); assert.equal(regionName('North'), 'ಉತ್ತರ'); assert.equal(typeName('Signal fault'), 'ಸಿಗ್ನಲ್ ದೋಷ'); assert.equal(typeName('Unknown thing'), 'Unknown thing');
  assert.match(agoText(Date.now() - 5 * 60e3), /ನಿ\./);
  setI18nLang('en'); assert.equal(typeName('Signal fault'), 'Signal fault'); assert.equal(agoText(Date.now() - 10e3), '10s ago');
});
