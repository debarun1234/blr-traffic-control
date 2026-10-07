import { h, toast, ago, fmtN } from '../vendor/ui.mjs';
import { ROLES } from '../vendor/shared.mjs';
import { api, list, qs, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, mkField, input, toggle, errorSummary, validateFields, showSummary, serverError, openDialog, svg, fmtUsd, fmtDT, busy, uid } from '../lib/kit.mjs';
import { getSettings } from '../lib/actions.mjs';
import { aiSwitchDialog } from '../lib/actions.mjs';
import { validateAiLimits } from '../lib/logic.mjs';

const TIERS = [['t0', 'Templates (t0)', 'var(--ink-3)'], ['t1', 'Light model (t1)', 'var(--info)'], ['t2', 'Mid model (t2)', 'var(--accent)'], ['t3', 'Brief model (t3)', 'var(--c3)']];
const dayLabel = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = [1, 2, 4, 8, 10].find((x) => x * p >= v); return m * p; };

/** Accessible inline-SVG bar chart (stacked optional) with keyboard-focusable columns and a hidden data table. */
function barChart({ title, days, series, stacked = true, fmt = (v) => fmtN(v), unit = '' }) {
  const W = 720, H = 230, L = 46, R = 10, T = 12, B = 28, iw = W - L - R, ih = H - T - B;
  const tot = (d) => (stacked ? series.reduce((a, s) => a + (s.val(d) || 0), 0) : Math.max(...series.map((s) => s.val(d) || 0)));
  const max = niceMax(Math.max(...days.map(tot), 0)); const bw = iw / days.length;
  const readout = h('div.sm.muted', { 'aria-live': 'polite', style: { minHeight: '20px' } }, 'Hover or focus a bar for the numbers.');
  const g = svg('g'); const grid = svg('g.grid');
  for (let i = 0; i <= 4; i++) { const y = T + ih - (ih * i) / 4; grid.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y }), svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, fmt((max * i) / 4))); }
  days.forEach((d, i) => {
    const x = L + i * bw + bw * 0.16, w = bw * 0.68; let acc = 0;
    const label = `${dayLabel(d.date)}: ` + series.map((s) => `${s.label} ${fmt(s.val(d) || 0)}${unit}`).join(', ');
    const col = svg('g', { tabindex: '0', role: 'img', 'aria-label': label, class: 'col' });
    col.append(svg('rect', { x: L + i * bw, y: T, width: bw, height: ih, fill: 'transparent' }));
    series.forEach((s) => { const v = s.val(d) || 0, hh = (v / max) * ih; if (!hh) return; const y = stacked ? T + ih - ((acc + v) / max) * ih : T + ih - hh; col.append(svg('rect', { x: stacked ? x : x + (w / series.length) * series.indexOf(s), y, width: stacked ? w : w / series.length, height: hh, fill: s.color, rx: 1.5 })); acc += v; });
    const show = () => { readout.textContent = label; col.classList.add('on'); }, hide = () => col.classList.remove('on');
    col.addEventListener('mouseenter', show); col.addEventListener('focus', show); col.addEventListener('mouseleave', hide); col.addEventListener('blur', hide);
    g.append(col);
    if (i % 2 === (days.length % 2 ? 0 : 1) || days.length < 8) g.append(svg('text', { x: L + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle' }, dayLabel(d.date)));
  });
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', width: '100%', role: 'group', 'aria-label': title }, svg('line', { class: 'axis', x1: L, x2: W - R, y1: T + ih, y2: T + ih }), grid, g);
  const tbl = h('table.sr', h('caption', title), h('thead', h('tr', h('th', 'Date'), series.map((s) => h('th', s.label)))), h('tbody', days.map((d) => h('tr', h('td', d.date), series.map((s) => h('td', fmt(s.val(d) || 0)))))));
  return h('div', h('div.legend', series.map((s) => h('span', h('i', { style: { background: s.color } }), s.label))), el, readout, tbl);
}

export async function mount(root, ctx) {
  const host = h('div');
  const head = h('div'); root.append(head, host);
  const reload = loader(host, async () => {
    const [usageR, S, killAudit] = await Promise.all([api.get('/admin/ai/usage?days=14'), getSettings(), api.get('/admin/audit' + qs({ kind: 'budget_kill', limit: 1 })).catch(() => null)]);
    const days = list(usageR, ['usage', 'days']).slice(-14); const ai = S.ai; const today = days.at(-1);
    head.replaceChildren(pageHeader('AI & cost', 'Gemini usage, spend and the limits that protect the budget. Every call checks the kill switch, then the per-user quota, then the global cap, then the cache, and only then calls a model.',
      h('span.badge' + (ai.enabled ? '.good' : '.bad'), { id: 'ai-state' }, h('span.dot' + (ai.enabled ? '.good' : '.bad')), ai.enabled ? 'AI is on' : 'AI is off'),
      h('button.btn' + (ai.enabled ? '.danger' : '.primary'), { id: 'ai-kill', onclick: async () => { if (await aiSwitchDialog(!ai.enabled)) reload(); } }, ai.enabled ? 'Turn AI off (kill switch)' : 'Turn AI back on')));
    const sum = (f) => days.reduce((a, d) => a + (f(d) || 0), 0);
    const hit = (d) => { const t = (d.calls || 0) + (d.cacheHits || 0); return t ? d.cacheHits / t : 0; };
    const calls14 = sum((d) => d.calls), cost14 = sum((d) => d.estCostUsd), hits14 = sum((d) => d.cacheHits);
    const pct = ai.dailyCallCap ? (today?.calls ?? 0) / ai.dailyCallCap : 0;
    const budget = killAudit && list(killAudit, ['audit', 'entries', 'rows'])[0];
    const kpi = (cls, l, v, s) => h('div.kpi' + (cls ? '.' + cls : ''), h('div.l', l), h('div.v', v), h('div.s', s));
    const kpis = h('div.stat-row', kpi(pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '', 'Calls today', `${fmtN(today?.calls ?? 0)} / ${fmtN(ai.dailyCallCap)}`, `${Math.round(pct * 100)}% of the daily cap`), kpi('', 'Est. cost today', fmtUsd(today?.estCostUsd ?? 0), `${fmtN((today?.tokensIn ?? 0) / 1000)}k tokens in, ${fmtN((today?.tokensOut ?? 0) / 1000)}k out`), kpi('', 'Est. cost, 14 days', fmtUsd(cost14), `${fmtN(calls14)} model calls`), kpi('', 'Cache hit rate, 14 days', calls14 + hits14 ? Math.round((hits14 / (calls14 + hits14)) * 100) + '%' : '-', 'answered without a model call'));
    const topUsers = Object.entries(today?.byUser ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const killCard = h('section.card' + (ai.enabled ? '' : '.kill-card'), h('div.card-h', h('h2', 'Kill switch & budget alert')),
      h('dl.kv', h('dt', 'State'), h('dd', ai.enabled ? 'On' : h('b.bad', 'Off')), ai.killReason ? [h('dt', 'Last reason'), h('dd', ai.killReason)] : null,
        h('dt', 'Budget alert'), h('dd', budget ? [h('b.warn', 'Last automatic shut-off'), ` ${ago(budget.at)}: ${budget.summary}`] : 'No automatic shut-off recorded. If monthly spend reaches the billing budget, AI turns off by itself and paid connectors are disabled.'),
        h('dt', 'Daily cap'), h('dd', h('div.meter' + (pct >= 1 ? '.bad' : pct >= .8 ? '.warn' : ''), { role: 'meter', 'aria-label': 'Daily call cap used', 'aria-valuenow': Math.round(pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, style: { marginTop: '6px', maxWidth: '260px' } }, h('i', { style: { width: Math.min(100, pct * 100) + '%' } })))),
      h('p.xs.faint', { style: { marginTop: '10px' } }, 'At 100% of the daily cap, AI falls back to templates until midnight IST.'));
    const routing = h('section.card', h('div.card-h', h('h2', 'How a request is routed')),
      h('ol.ul', { style: { color: 'var(--ink)' } }, h('li', h('b', 't0 Templates'), ': deterministic text, no model, free. Always available, and the fallback.'), h('li', h('b', 't1 Light'), ': cheapest Gemini. Translation to Kannada and short summaries.'), h('li', h('b', 't2 Mid'), ': action advice and works-clash narratives.'), h('li', h('b', 't3 Brief'), ': strongest model. Commissioner brief only, cached per hour.')),
      h('p.xs.faint', { style: { marginTop: '8px' } }, 'A tier switched off here falls through to the next cheaper tier, ending at t0. Model ids come from these settings, never from code.'));
    const limits = limitsCard(ai);
    return h('div.stack', { style: { gap: '16px' } }, kpis,
      h('div.grid.g2', h('section.card', h('div.card-h', h('h2', 'Calls per day, by tier')), barChart({ title: 'Model calls per day by tier, last 14 days', days, series: TIERS.map(([k, l, c]) => ({ key: k, label: l, color: c, val: (d) => d.byTier?.[k] })) })),
        h('section.card', h('div.card-h', h('h2', 'Estimated cost per day (USD)')), barChart({ title: 'Estimated cost per day in US dollars, last 14 days', days, stacked: false, series: [{ label: 'Est. cost', color: 'var(--accent)', val: (d) => d.estCostUsd }], fmt: (v) => (v >= 10 ? '$' + Math.round(v) : '$' + (+v).toFixed(2)) }))),
      h('div.grid.g2', h('section.card', h('div.card-h', h('h2', 'Cache hit rate')), barChart({ title: 'Cache hit rate per day', days, stacked: false, series: [{ label: 'Hit rate', color: 'var(--good)', val: (d) => Math.round(hit(d) * 100) }], fmt: (v) => Math.round(v) + '%' }), h('p.xs.faint', 'Cached answers / (model calls + cached answers). Cache entries live 24 h.')),
        h('div.stack', killCard, h('section.card', h('div.card-h', h('h2', 'Top users today')), topUsers.length ? h('table.tbl.compact', h('tbody', topUsers.map(([e, n]) => h('tr', h('td.mono', e), h('td.n', n))))) : h('p.sm.muted', 'No AI calls yet today.')))),
      limits, routing);
  });

  function limitsCard(ai) {
    const summary = errorSummary(); const F = {};
    const num = (key, label, v, o = {}) => { const el = input({ type: 'number', value: String(v), min: '0', inputmode: 'numeric' }); F[key] = mkField(label, el, { hint: o.hint, validate: () => collect().errors[key] ?? null }); return F[key]; };
    const tierEls = {};
    for (const t of ['t1', 't2', 't3']) {
      const on = toggle(ai.tiers[t].enabled, `Tier ${t} enabled`); const model = input({ value: ai.tiers[t].model ?? '', placeholder: 'gemini-…', 'aria-label': `Model id for ${t}` });
      tierEls[t] = { on, model, field: mkField(`Model id (${t})`, model, { validate: () => collect().errors[`tiers.${t}.model`] ?? null }) };
    }
    const cap = num('dailyCallCap', 'Global daily call cap', ai.dailyCallCap, { hint: 'Model calls per day across all users. Resets at midnight IST.' });
    const per = ROLES.map((r) => num(`perUserDaily.${r}`, `Per-user daily: ${r}`, ai.perUserDaily?.[r] ?? 0));
    const collect = () => {
      const v = (k) => (F[k].ctl.value === '' ? NaN : Number(F[k].ctl.value));
      const next = { dailyCallCap: v('dailyCallCap'), perUserDaily: Object.fromEntries(ROLES.map((r) => [r, v(`perUserDaily.${r}`)])), tiers: Object.fromEntries(['t1', 't2', 't3'].map((t) => [t, { enabled: tierEls[t].on.input.checked, model: tierEls[t].model.value.trim() }])) };
      return { next, errors: validateAiLimits(next) };
    };
    const form = h('form.stack', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); const { next, errors } = collect();
      const fl = [cap, ...per, ...['t1', 't2', 't3'].map((t) => tierEls[t].field)];
      fl.forEach((f) => f.check()); const bad = fl.filter((f) => f.dataset.err);
      if (bad.length) { showSummary(summary, `${bad.length} field${bad.length > 1 ? 's' : ''} invalid`, bad.map((f) => ({ text: `${f.fieldLabel}: ${f.dataset.err}`, focus: f.ctl }))); bad[0].ctl.focus(); return; }
      summary.classList.add('hide');
      await busy(form.querySelector('[type=submit]'), async () => { try { await api.put('/admin/ai/limits', next); toast('AI limits saved', 'good'); reload(); } catch (x) { serverError(summary, x); } });
    } }, summary,
      h('div.fgrid', cap), h('h3', 'Per-user daily quota'), h('div.fgrid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' } }, per),
      h('h3', 'Tiers'), h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Tier'), h('th', 'Enabled'), h('th', 'Model id'))), h('tbody',
        h('tr', h('td', h('b', 't0'), h('span.sub', 'templates, no model')), h('td', h('span.badge.good', 'Always on')), h('td.faint', 'n/a')),
        ['t1', 't2', 't3'].map((t) => h('tr', h('td', h('b', t), h('span.sub', t === 't1' ? 'cheapest' : t === 't2' ? 'mid' : 'strongest, brief only')), h('td', tierEls[t].on), h('td', tierEls[t].field)))))),
      h('div.row', h('button.btn.primary', { type: 'submit', id: 'ai-limits-save' }, 'Save limits')));
    return h('section.card', h('div.card-h', h('h2', 'Caps and tiers')), form);
  }
}
