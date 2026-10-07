import { createFirestoreStoreFromEnv, createSecretManagerReader, systemClock, assertAuthConfig } from '@blr/core';
import { buildWorker, createOidcVerifier } from './server.mjs';

assertAuthConfig(process.env);
const store = await createFirestoreStoreFromEnv(process.env);
const app = await buildWorker({
  store, clock: systemClock, env: process.env,
  verifier: createOidcVerifier({ audience: process.env.INTERNAL_AUDIENCE }),
  secretReader: createSecretManagerReader({ projectId: process.env.GOOGLE_CLOUD_PROJECT }),
});
const shutdown = async (sig) => { app.log.info({ sig }, 'shutting down'); try { await app.close(); } finally { process.exit(0); } };
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => shutdown(s));
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
