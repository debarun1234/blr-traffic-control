import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { err } from '../errors.mjs';

export async function defaultResolve(host) { return (await lookup(host, { all: true })).map((a) => a.address); }

function v4Blocked(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
/** True for loopback, private, link-local, CGNAT, multicast, reserved and cloud-metadata addresses. */
export function isBlockedIp(ip) {
  const v = isIP(ip);
  if (v === 4) return v4Blocked(ip);
  if (v !== 6) return true;
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s); if (mapped) return v4Blocked(mapped[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hexMapped) { const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16); return v4Blocked([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
  const first = parseInt(s.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
}
const BAD_HOST = /(^|\.)(localhost|internal|local|localdomain|home\.arpa)$/i;

/** Validate URL + resolve DNS and reject unsafe targets. Returns the parsed URL. */
export async function assertSafeUrl(raw, { production = false, resolve = defaultResolve } = {}) {
  let u; try { u = new URL(raw); } catch { throw err('invalid', 'Invalid URL'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !production)) throw err('invalid', production ? 'Only https URLs are allowed' : 'Only http(s) URLs are allowed');
  if (u.username || u.password) throw err('invalid', 'Credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BAD_HOST.test(host)) throw err('invalid', 'Host is not allowed');
  const addrs = isIP(host) ? [host] : await resolve(host);
  if (!addrs.length) throw err('invalid', 'Host did not resolve');
  if (addrs.some(isBlockedIp)) throw err('invalid', 'URL resolves to a private or reserved address');
  return u;
}

async function readCapped(res, maxBytes) {
  const len = Number(res.headers?.get?.('content-length')); if (len > maxBytes) throw err('invalid', `Response exceeds ${maxBytes} bytes`);
  if (res.body?.getReader) {
    const rd = res.body.getReader(), chunks = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > maxBytes) { rd.cancel().catch(() => {}); throw err('invalid', `Response exceeds ${maxBytes} bytes`); } chunks.push(value); }
    return Buffer.concat(chunks).toString('utf8');
  }
  const t = await res.text(); if (Buffer.byteLength(t) > maxBytes) throw err('invalid', `Response exceeds ${maxBytes} bytes`); return t;
}

/**
 * The single outbound HTTP path for connectors: SSRF guard, no redirects, timeout, size cap.
 * @returns {(url:string, init?:object, o?:{maxBytes?:number,timeoutMs?:number})=>Promise<{status:number,ok:boolean,text:string,json():any}>}
 */
export function createSafeFetch({ fetch = globalThis.fetch, resolve = defaultResolve, production = false, maxBytes = 1_000_000, timeoutMs = 8000 } = {}) {
  return async (url, init = {}, o = {}) => {
    const u = await assertSafeUrl(url, { production, resolve });
    const res = await fetch(u.toString(), { ...init, redirect: 'manual', signal: AbortSignal.timeout(Math.min(o.timeoutMs ?? timeoutMs, 30000)) });
    if (res.status >= 300 && res.status < 400) throw err('invalid', 'Redirects are not followed');
    const text = await readCapped(res, Math.min(o.maxBytes ?? maxBytes, 5_000_000));
    return { status: res.status, ok: res.ok ?? (res.status >= 200 && res.status < 300), text, json() { return JSON.parse(text); } };
  };
}
