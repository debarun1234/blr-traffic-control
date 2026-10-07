// Minimal Firestore REST client for operator scripts (seed, admin listing). Uses ADC via the gcloud CLI, no key files.
import { execFileSync } from 'node:child_process';

export function adcToken() {
  try {
    return execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error('No Application Default Credentials. Run: gcloud auth application-default login');
  }
}

/** JS value -> Firestore REST Value. Integers become integerValue, other numbers doubleValue. */
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`unsupported value type: ${typeof v}`);
}
export function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));
}
export function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}
export function fromFields(f) { return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)])); }

export function client(project, database = '(default)') {
  const token = adcToken();
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}/documents`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': project };
  return {
    /** Create-only unless overwrite. Returns 'created' | 'exists' | 'written'. */
    async put(path, data, { overwrite = false } = {}) {
      const url = new URL(`${base}/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!overwrite) url.searchParams.set('currentDocument.exists', 'false');
      const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields: toFields(data) }) });
      if (res.ok) return overwrite ? 'written' : 'created';
      const body = await res.text();
      if (!overwrite && (res.status === 409 || res.status === 400) && /ALREADY_EXISTS|already exists|FAILED_PRECONDITION/i.test(body)) return 'exists';
      throw new Error(`Firestore PATCH ${path} -> ${res.status}: ${body.slice(0, 300)}`);
    },
    async query(collection, field, op, value, limit = 50) {
      const res = await fetch(`${base}:runQuery`, {
        method: 'POST', headers,
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } }, limit } }),
      });
      if (!res.ok) throw new Error(`Firestore query ${collection} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()).filter((r) => r.document).map((r) => fromFields(r.document.fields ?? {}));
    },
  };
}
