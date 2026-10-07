/** Secret Manager reader (lazy import). `ref` is a secret name; latest version is read. Values are never logged. */
export function createSecretManagerReader({ projectId = process.env.GOOGLE_CLOUD_PROJECT } = {}) {
  let client; const cache = new Map();
  return async (ref) => {
    const hit = cache.get(ref); if (hit && Date.now() - hit.at < 300000) return hit.v;
    if (!client) { const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager'); client = new SecretManagerServiceClient(); }
    const [v] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${ref}/versions/latest` });
    const s = v.payload.data.toString('utf8'); cache.set(ref, { at: Date.now(), v: s }); return s;
  };
}
