#!/usr/bin/env node
// Repository guard rails (no dependencies). Exit 1 on any error.
//   secrets      private keys, service-account JSON, Google OAuth/API keys, cloud/token patterns
//   auth mode    AUTH_MODE=dev must not appear in infra, workflows, Dockerfiles or Firebase config
//   leftovers    task markers in shipped code
//   json         map.json (+ structure), crash.json, firebase.json, firestore indexes, package.json files
//   hosting      firebase.json routes /api,/ingest to the API and ships a strict CSP; Firestore rules deny all
//   terraform    no SA keys, no owner/editor roles, allUsers only on the API service
// Flags: --dist (also check built apps/*/dist/config.js is not dev config), --strict (warnings fail too)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const errors = [];
const warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.terraform', '__pycache__', 'coverage', '.firebase']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.yml', '.yaml', '.tf', '.tfvars', '.hcl', '.sh', '.html', '.css', '.py', '.txt', '.example', '.rules', '']);
const BIG_DATA = [/^tools\/mapdata\/(data|stage\d)/, /^packages\/mapdata\/.*\.json$/, /^tools\/mapdata\/map\.json$/, /package-lock\.json$/];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(root)].map((p) => ({ abs: p, rel: relative(root, p).split('\\').join('/') }));
const readText = (abs) => readFileSync(abs, 'utf8');
const isText = (f) => TEXT_EXT.has(extname(f.rel)) || /(^|\/)Dockerfile/.test(f.rel) || basename(f.rel).startsWith('.env');

// ---- secrets ---------------------------------------------------------------------------------------------------------
const HARD = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/"type"\s*:\s*"service_account"/, 'service-account key JSON'],
  [/GOCSPX-[A-Za-z0-9_-]{20,}/, 'Google OAuth client secret'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key (even "public" web keys belong in generated config, not in source)'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bya29\.[A-Za-z0-9_-]{30,}/, 'Google OAuth access token'],
];
const SOFT = /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s]{16,}["']/i;
const SOFT_OK = /example|placeholder|changeme|your|xxxx|<[^>]+>|\$\{|process\.env|\$\(|test|dummy|fake|redacted/i;

for (const f of files) {
  if (f.rel === 'scripts/lint.mjs' || !isText(f) || BIG_DATA.some((r) => r.test(f.rel))) continue;
  if (statSync(f.abs).size > 2_000_000) continue;
  const lines = readText(f.abs).split('\n');
  lines.forEach((line, i) => {
    if (line.includes('lint-allow-secret')) return;
    for (const [re, what] of HARD) if (re.test(line)) err(`${f.rel}:${i + 1}`, `possible secret: ${what}`);
    const m = SOFT.exec(line);
    if (m && !SOFT_OK.test(line)) warn(`${f.rel}:${i + 1}`, 'hard-coded credential-looking assignment');
  });
}

// ---- AUTH_MODE=dev in deployable config -------------------------------------------------------------------------------
const PROD_CFG = (r) => /^(infra|\.github)\//.test(r) || /(^|\/)Dockerfile/.test(r) || r === 'firebase.json' || /\.tfvars/.test(r) || /(^|\/)(cloudbuild|app)\.ya?ml$/.test(r);
for (const f of files) {
  if (!PROD_CFG(f.rel) || !isText(f)) continue;
  readText(f.abs).split('\n').forEach((line, i) => {
    if (/AUTH_MODE["']?\s*[=:]\s*["']?dev\b/.test(line) && !/lint-allow-dev/.test(line)) err(`${f.rel}:${i + 1}`, 'AUTH_MODE=dev in a deployable config');
  });
}
if (args.has('--dist')) {
  for (const app of ['control', 'admin']) {
    const c = join(root, 'apps', app, 'dist', 'config.js');
    if (!existsSync(c)) { err(`apps/${app}/dist/config.js`, 'missing (run build:web and scripts/render-deploy-config.mjs)'); continue; }
    const t = readText(c);
    if (!/authMode['"]?\s*:\s*['"]google['"]/.test(t)) err(`apps/${app}/dist/config.js`, "authMode must be exactly 'google' (the apps fall back to the dev picker for any other value)");
    if (/firebase['"]?\s*:\s*null/.test(t)) err(`apps/${app}/dist/config.js`, 'firebase config is null');
  }
}

// ---- task markers in shipped code -------------------------------------------------------------------------------------
const MARK = new RegExp('\\b(' + ['TO', 'DO'].join('') + '|' + ['FIX', 'ME'].join('') + '|' + ['HA', 'CK'].join('') + ')\\b');
const SHIPPED = (r) => /^(apps\/[^/]+\/src|apps\/api|apps\/worker|packages\/[^/]+\/src|scripts|infra)\//.test(r) && !/(^|\/)(test|tests|node_modules|reference-v3)\//.test(r) && !/\.test\.mjs$/.test(r) && r !== 'scripts/lint.mjs';
for (const f of files) {
  if (!SHIPPED(f.rel) || !isText(f)) continue;
  readText(f.abs).split('\n').forEach((line, i) => { if (MARK.test(line)) err(`${f.rel}:${i + 1}`, 'task marker in shipped code'); });
}

// ---- JSON ---------------------------------------------------------------------------------------------------------------
const json = {};
for (const rel of ['packages/mapdata/map.json', 'packages/mapdata/crash.json', 'tools/mapdata/map.json', 'firebase.json', 'firestore.indexes.json', '.firebaserc.example', 'package.json']) {
  const abs = join(root, rel);
  if (!existsSync(abs)) { err(rel, 'missing'); continue; }
  try { json[rel] = JSON.parse(readText(abs)); } catch (e) { err(rel, `invalid JSON: ${e.message}`); }
}
for (const f of files) if (/(^|\/)package\.json$/.test(f.rel)) { try { JSON.parse(readText(f.abs)); } catch (e) { err(f.rel, `invalid JSON: ${e.message}`); } }

const map = json['packages/mapdata/map.json'];
if (map) {
  for (const k of ['o', 's', 'st', 'reg', 'city', 'hubs', 'nxy', 'n', 'd', 'r', 'nn']) if (!(k in map)) err('packages/mapdata/map.json', `missing key ${k}`);
  if (Array.isArray(map.nxy) && map.nn !== map.nxy.length) err('packages/mapdata/map.json', `nn (${map.nn}) != nxy.length (${map.nxy.length})`);
  if (Array.isArray(map.r)) {
    let bad = 0, loops = 0;
    for (const e of map.r) {
      if (e.length !== 6 || e[0] < 0 || e[1] < 0 || e[0] >= map.nn || e[1] >= map.nn || e[2] < 0 || e[3] < 0 || e[3] > 2 || e[5] >= map.d.length) bad++;
      else if (e[0] === e[1] || e[2] === 0) loops++;
    }
    if (bad) err('packages/mapdata/map.json', `${bad} malformed routable edges`);
    if (loops) warn('packages/mapdata/map.json', `${loops} degenerate edges (self-loop or zero length); harmless to the model but worth removing in tools/mapdata/graph12.py`);
    const stBad = (map.st ?? []).filter((s) => !(s.node >= 0 && s.node < map.nn) || !s.n || !s.r).length;
    if (stBad) err('packages/mapdata/map.json', `${stBad} stations with bad node/name/region`);
  }
  if (map.tools) { /* no-op: allow future metadata */ }
}
const idx = json['firestore.indexes.json'];
if (idx && (!Array.isArray(idx.indexes) || idx.indexes.some((i) => !i.collectionGroup || !Array.isArray(i.fields) || i.fields.length < 2))) err('firestore.indexes.json', 'each composite index needs collectionGroup and >= 2 fields');

// ---- Firebase Hosting + rules ----------------------------------------------------------------------------------------
const fb = json['firebase.json'];
if (fb) {
  if (!Array.isArray(fb.hosting) || fb.hosting.length !== 2) err('firebase.json', 'expected exactly two hosting entries (control, admin)');
  for (const h of fb.hosting ?? []) {
    const id = h.target ?? '?';
    for (const p of ['/api/**', '/ingest/**']) {
      const r = (h.rewrites ?? []).find((x) => x.source === p);
      if (!r || r.run?.serviceId !== 'blr-api') err('firebase.json', `${id}: ${p} must rewrite to Cloud Run service blr-api`);
    }
    const all = (h.headers ?? []).find((x) => x.source === '**');
    const get = (k) => all?.headers?.find((x) => x.key.toLowerCase() === k)?.value ?? '';
    const csp = get('content-security-policy');
    if (!csp) err('firebase.json', `${id}: missing Content-Security-Policy`);
    if (/unsafe-eval/.test(csp) || /script-src[^;]*'unsafe-inline'/.test(csp)) err('firebase.json', `${id}: CSP allows unsafe script execution`);
    if (!/frame-ancestors 'none'/.test(csp)) err('firebase.json', `${id}: CSP must set frame-ancestors 'none'`);
    for (const k of ['strict-transport-security', 'x-content-type-options', 'referrer-policy']) if (!get(k)) err('firebase.json', `${id}: missing header ${k}`);
    // Every inline <script> in the app's HTML must be allowed by hash (CSP has no 'unsafe-inline' for scripts).
    const htmlPath = join(root, 'apps', id, 'src', 'index.html');
    if (existsSync(htmlPath)) {
      for (const m of readText(htmlPath).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        const hash = `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`;
        if (!csp.includes(hash)) err('firebase.json', `${id}: inline script in apps/${id}/src/index.html is not allowed by CSP; add ${hash} to script-src (or externalise the script)`);
      }
    }
  }
}
const rulesPath = join(root, 'firestore.rules');
if (!existsSync(rulesPath)) err('firestore.rules', 'missing');
else {
  const t = readText(rulesPath).replace(/\/\/.*$/gm, '');
  if (!/allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(t) || /if\s+true|request\.auth/.test(t)) err('firestore.rules', 'must deny all client access (allow read, write: if false)');
}

// ---- Terraform / CI guard rails ---------------------------------------------------------------------------------------
for (const f of files) {
  if (/^infra\/.*\.tf$/.test(f.rel)) {
    const t = readText(f.abs).replace(/#.*$/gm, '');
    if (/google_service_account_key/.test(t)) err(f.rel, 'service-account keys are forbidden (use WIF / attached service accounts)');
    if (/roles\/(owner|editor)\b/.test(t)) err(f.rel, 'primitive role owner/editor is forbidden');
    if (/allUsers|allAuthenticatedUsers/.test(t) && f.rel !== 'infra/terraform/modules/run/main.tf') err(f.rel, 'public IAM member outside the API service');
  }
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(f.rel)) {
    const t = readText(f.abs);
    if (/credentials_json|GOOGLE_CREDENTIALS|GCP_SA_KEY/.test(t)) err(f.rel, 'JSON key credentials are forbidden; use Workload Identity Federation');
  }
}

// ---- report -----------------------------------------------------------------------------------------------------------
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const failed = errors.length > 0 || (args.has('--strict') && warnings.length > 0);
console.log(`lint: ${files.length} files scanned, ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(failed ? 1 : 0);
