// Local development server: memory store seeded with demo data, AUTH_MODE=dev, tick every 60 s,
// and the built web apps served statically. Dev only: never use in production.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createMemoryStore, createAiRouter, createVertexGenerate, runTick, systemClock, getNet, createConnectorRunner } from '@blr/core';
import { buildServer } from './server.mjs';

process.env.AUTH_MODE = 'dev';
process.env.NODE_ENV ??= 'development';
const here = dirname(fileURLToPath(import.meta.url));
const store = createMemoryStore(), net = getNet();

const crash = JSON.parse(readFileSync(join(here, '../../../packages/mapdata/crash.json'), 'utf8')), now = Date.now();
const stations = new Map();
for (const [, , name, nonfatal, fatal] of crash.cur['2025']) stations.set(name, { station: name, y2025: { fatal, nonfatal }, hist: {}, source: 'seed:crash.json', importedAt: now });
for (const [name, years] of Object.entries(crash.hist)) { const d = stations.get(name) ?? { station: name, y2025: { fatal: 0, nonfatal: 0 }, hist: {}, source: 'seed:crash.json', importedAt: now }; d.hist = years; stations.set(name, d); }
for (const d of stations.values()) await store.set('crash_stats', d.station, d);
const users = [['admin@example.test', 'admin'], ['commissioner@example.test', 'commissioner'], ['north.dcp@example.test', 'dcp', { region: 'North' }], ['yelahanka@example.test', 'station', { station: 'Yelahanka' }], ['indiranagar@example.test', 'station', { station: 'Indiranagar' }], ['viewer@example.test', 'viewer']];
for (const [email, role, extra] of users) await store.set('users', email, { email, name: email.split('@')[0], role, ...extra, active: true, createdBy: 'dev-seed', createdAt: now });

// Without GOOGLE_CLOUD_PROJECT there is no model: answer with a clearly labelled stub so the UI can be exercised.
const generate = process.env.GOOGLE_CLOUD_PROJECT ? createVertexGenerate({ env: process.env }) : async ({ model, prompt }) => ({ text: `[dev stub, no model configured (${model})] ${prompt.split('\n').pop().slice(0, 120)}`, tokensIn: 100, tokensOut: 30 });
const ai = createAiRouter({ store, clock: systemClock, generate });
const app = await buildServer({ store, ai, clock: systemClock, env: process.env, net, fetch: globalThis.fetch, secretReader: async () => { throw new Error('no secrets in dev'); } });

const connectors = createConnectorRunner({ store, net, clock: systemClock, production: false });
const tick = async () => { try { const r = await runTick({ store, net, now: Date.now(), connectors }); app.log.info({ tickMs: r.tickMs, created: r.created }, 'tick'); } catch (e) { app.log.error({ err: e.message }, 'tick failed'); } };
await tick(); setInterval(tick, 60000).unref();

const { default: fastifyStatic } = await import('@fastify/static');
const admin = join(here, '../../admin/dist'), control = join(here, '../../control/dist');
if (existsSync(admin)) await app.register(fastifyStatic, { root: admin, prefix: '/admin/' }); else app.log.warn('apps/admin/dist missing: run `npm run build:web`');
if (existsSync(control)) await app.register(fastifyStatic, { root: control, prefix: '/', decorateReply: false }); else app.log.warn('apps/control/dist missing: run `npm run build:web`');

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '127.0.0.1' });
console.log(`\nBLR traffic control (dev) on http://127.0.0.1:${port}  control: /   admin: /admin/\nSend header x-dev-user: ${users.map((u) => u[0]).join(' | ')}\n`);
