// Shared Playwright helpers (node playwright resolved from the global npm root; chromium from PLAYWRIGHT_BROWSERS_PATH).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(execSync('npm root -g').toString().trim() + '/x.js');
export const { chromium } = require('playwright');
export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

export const launch = () => chromium.launch({ headless: true, args: ['--no-sandbox'] });

/** New page with deterministic clock (09:00 IST on 2026-10-07), font stubs and console-error capture. */
export async function newPage(browser, mock, { viewport = { width: 1440, height: 900 }, colorScheme = 'light', lang = 'en', theme = null, fixedTime = true } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  await ctx.addInitScript(([l, th]) => { try { if (l && localStorage.getItem('blr-lang') == null) localStorage.setItem('blr-lang', l); if (th && localStorage.getItem('blr-theme') == null) localStorage.setItem('blr-theme', th); } catch {} }, [lang, theme]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: r.request().url().includes('googleapis') ? 'text/css' : 'font/woff2', body: '' }));
  if (fixedTime) await page.clock.setFixedTime(new Date(mock.FIXED_NOW));
  page.mock = mock; page.ctx = ctx;
  return page;
}
export async function open(page) { await page.goto(page.mock.url + '/'); }
export async function signIn(page, who) {
  await open(page);
  await page.getByTestId(`dev-${who}`).click();
  await ready(page);
}
/** Wait until the app shell and first state have rendered. */
export async function ready(page) {
  await page.waitForSelector('[data-testid=map]', { timeout: 20000 });
  await page.waitForSelector('[data-kpi=speed] .v span', { timeout: 20000 });
}
export async function canvasHash(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid=map]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) { h = (h * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) >>> 0; n++; }
    return h;
  });
}
export const kpi = (page, id) => page.locator(`[data-kpi=${id}] .v`).innerText();
export const tab = (page, id) => page.getByTestId(`tab-${id}`).click();

/** Contrast audit: every visible text node vs. its effective background; returns violations (< 4.5, or < 3 for >=18.66px bold / 24px). */
export async function contrastAudit(page) {
  return page.evaluate(() => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; if (!stack.length || stack[stack.length - 1].a < 1) { const d = parse(getComputedStyle(document.body).backgroundColor); if (d) base = d; } for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
    const out = [], seen = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const txt = n.textContent.trim(); if (!txt) continue; const el = n.parentElement; if (!el || seen.has(el)) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      if (el.closest('canvas,[hidden],svg')) continue; if (el.disabled || el.closest('[disabled]')) continue; seen.add(el);
      const fg = parse(cs.color), bg = bgOf(el); if (!fg) continue; const f = over(fg, bg);
      const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 600, large = px >= 24 || (px >= 18.66 && bold);
      if (ratio < (large ? 3 : 4.5)) out.push({ text: txt.slice(0, 40), ratio: +ratio.toFixed(2), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, cls: el.className?.toString().slice(0, 40) });
    }
    return out;
  });
}
