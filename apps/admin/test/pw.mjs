/** Resolve the `playwright` library: local node_modules first, then the global npm root. Browsers: PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers). */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
export async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const m = await import(pathToFileURL(join(g, 'playwright', 'index.mjs')).href); return m.default ?? m;
}
