import { h, toast, ago, fmtN, icon } from '../vendor/ui.mjs';
import { api, list, errMsg } from '../lib/api.mjs';
import { pageHeader, skeleton, statusBadge, errorState, confirmDialog, busy, fmtMs, fmtUsd, fmtDT } from '../lib/kit.mjs';
import { getSettings, putSettings, runChecks, aiSwitchDialog } from '../lib/actions.mjs';
import { istDayStartMs } from '../lib/logic.mjs';

const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));

export async function mount(root, ctx) {
  const body = h('div.stack', { style: { gap: '16px' } }, skeleton(6));
  root.append(pageHeader('Overview', 'Is the platform healthy right now? Everything here is read live from the API.', h('button.btn', { id: 'refresh', onclick: load }, 'Refresh')), body);
  let timer = setInterval(() => { if (!document.hidden) load(true); }, 60000);
  await load();
  return () => clearInterval(timer);

  async function load(quiet) {
    const [checks, state, conns, usage, settings, actions, users] = await Promise.all([
      settle(api.get('/admin/checks')), settle(api.get('/state')), settle(api.get('/admin/connectors')), settle(api.get('/admin/ai/usage?days=14')),
      settle(getSettings()), settle(api.get('/actions?state=open&limit=500')), settle(api.get('/admin/users'))]);
    if (!root.isConnected) return;
    body.replaceChildren(view({ checks, state, conns, usage, settings, actions, users }));
  }

  function card(title, node, ...extra) { return h('section.card', h('div.card-h', h('h2', title), ...extra), node); }
  const failed = (r) => h('p.sm.bad', { role: 'alert' }, 'Unavailable: ' + errMsg(r.e));

  function view({ checks, state, conns, usage, settings, actions, users }) {
    const S = settings.v, st = state.v;
    const results = checks.v?.results ?? []; const cnt = { ok: 0, warn: 0, fail: 0 }; results.forEach((r) => cnt[r.status]++);
    const worst = cnt.fail ? 'fail' : cnt.warn ? 'warn' : results.length ? 'ok' : 'unknown';
    const cl = list(conns.v ?? [], 'connectors'); const clActive = cl.filter((c) => c.enabled);
    const bad = clActive.filter((c) => c.lastRun && !c.lastRun.ok).length;
    const days = list(usage.v ?? [], ['usage', 'days']); const today = days.find((d) => d.date === todayIso()) ?? days.at(-1);
    const cap = S?.ai?.dailyCallCap, calls = today?.calls ?? 0, pct = cap ? calls / cap : 0;
    const esc = list(actions.v ?? [], 'actions').filter((a) => a.escalated && !['done', 'cleared'].includes(a.state));
    const us = list(users.v ?? [], 'users'); const online = us.filter((u) => u.lastLogin && Date.now() - u.lastLogin < 15 * 60000);
    const tickAge = st ? Date.now() - st.updatedAt : null; const staleMin = S?.feed?.staleAfterMin;
    const stale = st ? st.stale || (staleMin && tickAge > staleMin * 60000) : false;

    const banners = [];
    if (S?.maintenance) banners.push(h('div.banner', icon('alert', 16), h('span', h('b', 'Maintenance mode is on. '), 'The feed is paused and users see a maintenance notice.')));
    if (S && !S.ai?.enabled) banners.push(h('div.banner.bad', icon('alert', 16), h('span', h('b', 'AI is switched off. '), S.ai.killReason ? `Reason: ${S.ai.killReason}` : '')));
    if (stale) banners.push(h('div.banner.bad', icon('clock', 16), h('span', h('b', 'The feed is stale. '), `Last tick ${ago(st.updatedAt)}; threshold is ${staleMin} min. Check the connectors and the worker.`)));

    const kpi = (cls, l, v, s, id) => h('div.kpi' + (cls ? '.' + cls : ''), { dataset: { kpi: id } }, h('div.l', l), h('div.v', v), h('div.s', s));
    const kpis = h('div.stat-row.six',
      kpi(worst === 'ok' ? 'good' : worst === 'warn' ? 'warn' : worst === 'fail' ? 'bad' : '', 'System checks', checks.e ? 'n/a' : `${cnt.ok}/${results.length}`, checks.e ? errMsg(checks.e) : cnt.fail ? `OK · ${cnt.fail} failing` : cnt.warn ? `OK · ${cnt.warn} warning` : results.length ? 'all passing' : 'not run yet', 'checks'),
      kpi(stale ? 'bad' : S?.feed?.mode === 'sim' ? 'warn' : 'good', 'Feed', st ? st.mode.toUpperCase() : 'n/a', st ? `${stale ? 'STALE' : 'fresh'} · last tick ${ago(st.updatedAt)}` : state.e ? errMsg(state.e) : '', 'feed'),
      kpi(bad ? 'bad' : '', 'Connectors', conns.e ? 'n/a' : `${clActive.length - bad}/${clActive.length}`, conns.e ? errMsg(conns.e) : `healthy · ${cl.length - clActive.length} disabled`, 'connectors'),
      kpi(pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '', 'AI calls today', usage.e || settings.e ? 'n/a' : `${fmtN(calls)}${cap ? ' / ' + fmtN(cap) : ''}`, today ? `est. ${fmtUsd(today.estCostUsd)} spent` : 'no usage yet', 'ai'),
      kpi(esc.length ? 'bad' : 'good', 'Open escalations', actions.e ? 'n/a' : String(esc.length), actions.e ? errMsg(actions.e) : esc.length ? 'need a human now' : 'none', 'esc'),
      kpi('', 'Users online', users.e ? 'n/a' : String(online.length), users.e ? errMsg(users.e) : `${us.filter((u) => u.active).length} active · signed in < 15 min`, 'online'));

    const checkList = checks.e ? failed(checks) : !results.length ? h('p.sm.muted', 'No check results yet. Run the checks to populate this.') : h('div', results.map((r) => h('div.hrow', statusBadge(r.status), h('div.t', h('b', r.name), h('span', r.detail)), h('span.mono.faint.sm', fmtMs(r.ms)))));
    const connList = conns.e ? failed(conns) : !cl.length ? h('p.sm.muted', 'No connectors yet. ', h('a', { href: '#/connectors' }, 'Add one')) : h('div', cl.map((c) => {
      const s = !c.enabled ? 'off' : !c.lastRun ? 'unknown' : c.lastRun.ok ? 'ok' : 'fail';
      return h('div.hrow', h('span.dot' + (s === 'ok' ? '.good' : s === 'fail' ? '.bad' : ''), { title: s }), h('div.t', h('b', c.name), h('span', c.lastRun ? `${c.type} · ${c.lastRun.ok ? c.lastRun.count + ' records' : c.lastRun.error} · ${ago(c.lastRun.at)}` : `${c.type} · never run`)), c.mode === 'shadow' ? h('span.badge.info', 'shadow') : null, !c.enabled ? h('span.badge', 'off') : null);
    }));
    const meter = h('div', h('div.meter' + (pct >= 1 ? '.bad' : pct >= .8 ? '.warn' : ''), { role: 'meter', 'aria-label': 'AI daily call cap used', 'aria-valuenow': Math.round(pct * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: Math.min(100, pct * 100) + '%' } })), h('p.xs.faint', { style: { marginTop: '4px' } }, cap ? `${Math.round(pct * 100)}% of the daily cap` : ''));

    const feedBtn = h('button.btn', { id: 'qa-feed', onclick: (e) => toggleFeed(e.currentTarget, S) }, S?.maintenance ? 'Resume feed' : 'Pause feed');
    const aiBtn = h('button.btn' + (S?.ai?.enabled ? '.danger' : '.primary'), { id: 'qa-ai', onclick: async () => { if (await aiSwitchDialog(!S.ai.enabled)) load(); } }, S?.ai?.enabled ? 'AI kill switch' : 'Turn AI back on');
    const actionsCard = card('Quick actions', h('div.stack',
      h('div.row', h('button.btn.primary', { id: 'qa-checks', onclick: async (e) => { await busy(e.currentTarget, async () => { const r = await runChecks(); const f = (r.results ?? []).filter((x) => x.status === 'fail').length; toast(f ? `Checks done: ${f} failing` : 'Checks done: all passing', f ? 'bad' : 'good'); }); load(); } }, 'Run checks now'), feedBtn, aiBtn),
      h('p.xs.faint', 'Pausing the feed sets maintenance mode (state stops updating, users see a notice). The AI kill switch needs a reason and is audited.'), S ? meter : null));
    const feedCard = card('Feed & calibration', !st ? (state.e ? failed(state) : null) : h('dl.kv', h('dt', 'Mode'), h('dd', `${st.mode} (${st.mode === 'sim' ? 'modelled only' : 'modelled, calibrated against probes'})`), h('dt', 'Last tick'), h('dd', { title: fmtDT(st.updatedAt) }, ago(st.updatedAt)), h('dt', 'Tick every'), h('dd', S ? `${S.feed.tickMin} min (stale after ${S.feed.staleAfterMin})` : '-'), h('dt', 'Model boost'), h('dd.mono', st.boost?.toFixed?.(2) ?? '-'), h('dt', 'Calibration'), h('dd', st.calibration ? `${st.calibration.probes} probes, RMSE ${st.calibration.rmsePct}%` : h('span.faint', 'none')), h('dt', 'Road network'), h('dd', `${fmtN(st.net?.edges)} edges`)),
      h('a.btn.sm', { href: '#/settings' }, 'Feed settings'));
    return h('div.stack', { style: { gap: '16px' } }, ...banners, kpis,
      h('div.grid.g2', card('System checks', checkList, h('a.sm', { href: '#/checks' }, 'Details')), card('Connectors', connList, h('a.sm', { href: '#/connectors' }, 'Manage'))),
      h('div.grid.g2', actionsCard, feedCard));
  }
  async function toggleFeed(btn, S) {
    const on = !S.maintenance;
    const ok = await confirmDialog({ title: on ? 'Pause the feed?' : 'Resume the feed?', text: on ? 'Maintenance mode stops state updates and shows users a notice until you resume. Use it before changing connectors or during an incident with the data.' : 'The feed resumes on the next tick.', ok: on ? 'Pause feed' : 'Resume feed', danger: on });
    if (!ok) return;
    await busy(btn, async () => { const cur = await getSettings(); cur.maintenance = on; await putSettings(cur); ctx.setMaintenance(on); toast(on ? 'Feed paused (maintenance on)' : 'Feed resumed', 'good'); });
    load();
  }
}
const todayIso = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
