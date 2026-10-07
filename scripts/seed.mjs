#!/usr/bin/env node
// Seed Firestore: first admin user, default settings/app, crash_stats from packages/mapdata/crash.json.
// Create-only unless --force. Shapes follow docs/api-contract.md.
// Usage: node scripts/seed.mjs --project ID --admin-email e@x.org [--admin-name N] [--ai-enabled] [--force] [--dry-run]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './lib/firestore-rest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const project = opt('--project');
const email = String(opt('--admin-email', '')).trim().toLowerCase();
const dryRun = flag('--dry-run');
const force = flag('--force');
if (!project || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('usage: seed.mjs --project ID --admin-email you@example.com [--admin-name N] [--ai-enabled] [--force] [--dry-run]');
  process.exit(2);
}
const now = Date.now();

const user = { email, name: opt('--admin-name', email.split('@')[0]), role: 'admin', active: true, createdBy: 'seed', createdAt: now };

// Stored settings are merged over the code defaults (packages/core/src/settings.mjs), so seed from those defaults and
// change only what is a deliberate safety choice: AI starts OFF unless --ai-enabled is passed.
let settings;
try {
  const { defaultSettings } = await import('@blr/core');
  settings = defaultSettings(process.env);
} catch (e) {
  console.error(`warning: could not load @blr/core defaults (${e.message}); seeding a minimal settings doc`);
  settings = { feed: { mode: 'sim', tickMin: 10, staleAfterMin: 25 }, workflow: { escalateAfterMin: 15, verifyAfterMin: 30 }, ai: {}, caps: {}, maintenance: false };
}
settings.ai = { ...settings.ai, enabled: flag('--ai-enabled') };

// crash.json: cur[year] rows are [zone, subzone, station, nonfatal, fatal]; hist[station][year] is [fatal, nonfatal].
// (Column order verified by summing cur['2025'] column 4 = 807 = totals['2025'][0] fatal.)
const crash = JSON.parse(readFileSync(join(root, 'packages/mapdata/crash.json'), 'utf8'));
const crashDocs = crash.cur['2025'].map((r) => {
  const station = r[2];
  const hist = crash.hist[station] ?? {};
  return {
    station,
    y2025: { fatal: r[4], nonfatal: r[3] },
    hist,
    source: 'BTP via OpenCity (packages/mapdata/crash.json)',
    importedAt: now,
  };
});

const plan = [
  ['users/' + email, user],
  ['settings/app', settings],
  // Firestore ids cannot contain '/': station names such as 'Sheshadripuram/Chickpet' are stored with '_' in the id
  // (the original name stays in the `station` field).
  ...crashDocs.map((d) => ['crash_stats/' + d.station.replace(/\//g, '_'), d]),
];
console.log(`project=${project} docs=${plan.length} (1 user, 1 settings, ${crashDocs.length} crash_stats) mode=${force ? 'overwrite' : 'create-only'}${dryRun ? ' DRY-RUN' : ''}`);
if (dryRun) { for (const [p] of plan.slice(0, 5)) console.log('  would write', p); console.log('  ...'); process.exit(0); }

const db = client(project);
const tally = {};
for (const [path, data] of plan) {
  const r = await db.put(path, data, { overwrite: force });
  tally[r] = (tally[r] ?? 0) + 1;
}
console.log('result', tally);
console.log(`Sign in with ${email}. Add everyone else in the admin site (Users).`);
