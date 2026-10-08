#!/usr/bin/env node
// Assemble static web apps into apps/<app>/dist. No bundler: native ES modules + shared vendor files.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
for (const app of ['control', 'admin']) {
  const out = join(root, 'apps', app, 'dist');
  rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'vendor'), { recursive: true }); mkdirSync(join(out, 'assets'), { recursive: true });
  if (existsSync(join(root, 'apps', app, 'src'))) cpSync(join(root, 'apps', app, 'src'), out, { recursive: true });
  cpSync(join(root, 'packages/model/src/index.mjs'), join(out, 'vendor/model.mjs'));
  cpSync(join(root, 'packages/shared/src/index.mjs'), join(out, 'vendor/shared.mjs'));
  cpSync(join(root, 'packages/ui/src/ui.mjs'), join(out, 'vendor/ui.mjs'));
  cpSync(join(root, 'packages/ui/src/ui.css'), join(out, 'vendor/ui.css'));
  cpSync(join(root, 'packages/ui/src/welcome.mjs'), join(out, 'vendor/welcome.mjs'));
  cpSync(join(root, 'packages/ui/src/art.mjs'), join(out, 'vendor/art.mjs'));
  cpSync(join(root, 'packages/ui/src/btp-logo.png'), join(out, 'assets/btp-logo.png'));
  cpSync(join(root, 'packages/mapdata/map.json'), join(out, 'assets/map.json'));
  if (!existsSync(join(out, 'config.js'))) writeFileSync(join(out, 'config.js'), `// Overwritten by scripts/deploy.sh from Terraform outputs. Safe to publish (no secrets).\nwindow.__CONFIG__ = { authMode: 'dev', apiBase: '/api', version: '${version}', firebase: null };\n`);
  console.log('built', app);
}
