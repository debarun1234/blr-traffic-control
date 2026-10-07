// Thin fetch client for the /api contract. All errors are normalised to ApiError.
export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
  get network() { return this.status === 0; }
}
const CODES = { 400: 'invalid', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 429: 'rate_limited', 503: 'unavailable' };

export function createApi({ base = '/api', headers = async () => ({}), timeoutMs = 20000 } = {}) {
  async function req(method, path, { body, etag } = {}) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + path, {
        method, signal: ctl.signal, cache: 'no-store',
        headers: { accept: 'application/json', ...(await headers()), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(etag ? { 'if-none-match': etag } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new ApiError(0, 'network', e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'network error')); } finally { clearTimeout(to); }
    if (res.status === 304) return { status: 304, data: null, etag };
    let data = null; const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? CODES[res.status] ?? (res.status >= 500 ? 'unavailable' : 'error'), data?.error?.message ?? res.statusText, data?.error);
    return { status: res.status, data, etag: res.headers.get('etag') };
  }
  return {
    get: (p, o) => req('GET', p, o), post: (p, body) => req('POST', p, { body: body ?? {} }),
    patch: (p, body) => req('PATCH', p, { body }), del: (p) => req('DELETE', p),
  };
}
