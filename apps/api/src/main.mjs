// Production entry: Firestore store, Firebase ID-token verification, Vertex AI, Secret Manager.
import { createFirestoreStoreFromEnv, createFirebaseVerifier, createAiRouter, createVertexGenerate, createSecretManagerReader, systemClock, assertAuthConfig } from '@blr/core';
import { buildServer } from './server.mjs';

assertAuthConfig(process.env); // throws when AUTH_MODE=dev in production
const store = await createFirestoreStoreFromEnv(process.env);
const ai = createAiRouter({ store, clock: systemClock, generate: createVertexGenerate({ env: process.env }) });
const app = await buildServer({
  store, ai, clock: systemClock, env: process.env,
  verifier: createFirebaseVerifier({ projectId: process.env.GOOGLE_CLOUD_PROJECT }),
  secretReader: createSecretManagerReader({ projectId: process.env.GOOGLE_CLOUD_PROJECT }),
});
const shutdown = async (sig) => { app.log.info({ sig }, 'shutting down'); try { await app.close(); } finally { process.exit(0); } };
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => shutdown(s));
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
