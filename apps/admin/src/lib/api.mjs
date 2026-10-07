/** API client. One place for auth headers, error shaping and CSV/blob downloads. Never logs or stores secrets. */
export const cfg = Object.assign({ authMode: 'dev', apiBase: '/api', env: null, controlUrl: '/', firebase: null }, window.__CONFIG__ ?? {});
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const session = { getAuthHeaders: async () => ({}) };
export const setAuthProvider = (fn) => { session.getAuthHeaders = fn; };
export const onUnauthed = { fn: null };

async function request(path, { method = 'GET', body, headers = {}, raw = false, text = false } = {}) {
  const h = { accept: 'application/json', ...(await session.getAuthHeaders()), ...headers };
  let payload = body;
  if (body != null && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(cfg.apiBase + path, { method, headers: h, body: payload }); }
  catch (e) { throw new ApiError(0, 'network', 'Cannot reach the API. Check your connection and try again.'); }
  if (!res.ok) {
    let code = 'error', message = `Request failed (${res.status})`;
    try { const j = await res.json(); code = j.error?.code ?? code; message = j.error?.message ?? message; } catch {}
    if (res.status === 401 && onUnauthed.fn) onUnauthed.fn();
    throw new ApiError(res.status, code, message);
  }
  if (raw) return res;
  if (text) return res.text();
  if (res.status === 204) return null;
  return res.json();
}
export const api = {
  get: (p, o) => request(p, o),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  put: (p, body, o) => request(p, { ...o, method: 'PUT', body }),
  patch: (p, body, o) => request(p, { ...o, method: 'PATCH', body }),
  del: (p, o) => request(p, { ...o, method: 'DELETE' }),
  csv: (p, text) => request(p, { method: 'POST', body: text, headers: { 'content-type': 'text/csv' } }),
  blob: async (p) => (await request(p, { raw: true, headers: { accept: '*/*' } })).blob(),
};
/** Lists come back as {users:[…]} but accept a bare array too. */
export const list = (r, key) => { if (Array.isArray(r)) return r; for (const k of [].concat(key)) if (Array.isArray(r?.[k])) return r[k]; return []; };
export const qs = (o) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== '') u.set(k, v); const s = u.toString(); return s ? '?' + s : ''; };
export const errMsg = (e) => (e instanceof ApiError ? (e.code && e.code !== 'error' && e.code !== 'network' ? `${e.message} (${e.code})` : e.message) : String(e?.message ?? e));
