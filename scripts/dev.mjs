#!/usr/bin/env node
// Local development: build the web apps, then start the API dev server (apps/api/src/dev.mjs): in-memory store with demo
// data, AUTH_MODE=dev, a tick every 60 s, and both static sites served on one port.
//   control http://127.0.0.1:8080/    admin http://127.0.0.1:8080/admin/    (PORT overrides the port)
// Pick a user by sending header x-dev-user (the dev login in the UI does this). Never used in production: the API
// refuses to start with AUTH_MODE=dev when NODE_ENV=production.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devEntry = join(root, 'apps/api/src/dev.mjs');
if (!existsSync(devEntry)) { console.error('apps/api/src/dev.mjs not found'); process.exit(1); }

const built = spawnSync(process.execPath, [join(root, 'scripts/build-web.mjs')], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const child = spawn(process.execPath, [devEntry], { cwd: join(root, 'apps/api'), stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development', AUTH_MODE: 'dev' } });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
