// Actions workflow: list, transitions (optimistic), AI advice per card.
import { h, toast, fmtH } from '/vendor/ui.mjs';
import { canTransition } from '/vendor/shared.mjs';
import { S, emit, can, canActOn, inScope, openActions, setSel, setTab, curHour } from '../state.mjs';
import { transition, aiAdvise, aiAvailable } from '../feed.mjs';
import { nearestAlternate } from '../analytics.mjs';
import { t, regionName } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { reconcile, fill } from '../util.mjs';
import { sectionTitle, emptyState, stateBadge } from './common.mjs';
import { aiResult, aiError } from './ai.mjs';

const emitUpdate = () => emit('actions');
const advice = new Map(); // action id -> {status, data, err}
let filter = 'open', quotaOut = false;
const NEXT = { new: ['ack', 'act.ack'], ack: ['prog', 'act.start'], prog: ['done', 'act.done'] };

export function errText(e) {
  return e.status === 403 ? t('err.forbidden') : e.status === 409 ? t('err.conflict') : e.network ? t('err.network') : e.status === 401 ? t('err.unauth') : e.message || t('err.generic');
}
async function doTransition(a, to) {
  try { await transition(a.id, to); toast(t('act.updated', { to: t(`state.${to}`) }), 'good', 2500); }
  catch (e) { toast(errText(e), 'bad'); }
}
async function advise(a) {
  advice.set(a.id, { status: 'loading' }); emitUpdate();
  const net = S.MD.net, vc = S.result?.vc, alt = a.e >= 0 ? nearestAlternate(net, vc, a.e) : null;
  const ctx = { actionId: a.id, road: S.MD.edgeName(a.e, t('road.unnamed')), station: a.station, region: a.region, vc: vc && a.e >= 0 ? +vc[a.e].toFixed(2) : null, type: a.type, title: a.title, hour: +curHour().toFixed(2),
    alternate: alt ? { road: S.MD.NAMES[alt.nameIdx], vc: +alt.vc.toFixed(2) } : null };
  try { advice.set(a.id, { status: 'done', data: await aiAdvise(ctx) }); }
  catch (e) { if (e.code === 'quota_exceeded') quotaOut = true; advice.set(a.id, { status: 'error', err: e }); }
  emitUpdate();
}

export function actionCard(a) {
  const MD = S.MD, st = MD.ST[a.stn], nxt = NEXT[a.state];
  const mayAct = can('action.transition') && canActOn(a.stn), net = MD.net, vc = S.result?.vc;
  const alt = a.e >= 0 ? nearestAlternate(net, vc, a.e) : null, ad = advice.get(a.id);
  const inc = S.incidents.find((x) => x.id === a.incidentId), canAI = can('ai.advise') && aiAvailable() && !quotaOut;
  const sel = S.sel?.t === 'edge' && S.sel.e === a.e;
  const act = (to, label, kind = '') => h('button.btn.sm' + kind, { disabled: a.pending, 'data-fk': `${a.id}-${to}`, 'data-testid': `act-${to}`, onclick: () => doTransition(a, to) }, label);
  const ver = a.state === 'persist' ? h('span.badge.warn', t('act.persist')) : a.state === 'cleared' ? h('span.badge.good', ic('check', 12), t('act.cleared')) : a.state === 'done' ? h('span.badge.info', t('act.verifying')) : null;
  return h('article.card.cc-act' + (a.escalated && a.state !== 'cleared' ? '.esc' : '') + (a.state === 'cleared' ? '.done' : '') + (sel ? '.sel' : ''), { dataset: { id: a.id, state: a.state }, 'aria-label': a.title },
    h('div.cc-act-t', a.title || MD.edgeName(a.e, t('road.unnamed'))),
    h('div.row.cc-act-m', a.escalated && a.state !== 'cleared' ? h('span.badge.bad', { 'data-testid': 'esc-badge' }, t('badge.esc')) : null, a.pri === 'hi' ? h('span.badge.warn', t('badge.high')) : null, stateBadge(a.state),
      h('span.xs.faint', [st?.n, regionName(a.region), fmtH(a.raisedHour ?? 0)].filter(Boolean).join(' · '))),
    a.detail ? h('p.sm.cc-act-d', a.detail) : null,
    alt && a.state !== 'cleared' ? h('div.xs.muted.cc-hint', ic('route', 13), t('act.divert', { road: MD.NAMES[alt.nameIdx], vc: alt.vc.toFixed(2) })) : null,
    h('div.row.cc-act-btns', mayAct && nxt && canTransition(a.state, nxt[0]) ? act(nxt[0], a.pending ? t('computing') : t(nxt[1]), '.primary') : null,
      mayAct && (a.state === 'done' || a.state === 'persist') && canTransition(a.state, 'prog') ? act('prog', t(a.state === 'persist' ? 'act.resume' : 'act.reopen')) : null,
      ver,
      a.e >= 0 ? h('button.btn.sm.ghost', { onclick: () => { setSel({ t: 'edge', e: a.e }); const [x, y] = MD.edgeMid(a.e); S.mapRef.view.cx = x; S.mapRef.view.cy = y; S.mapRef.view.k = Math.max(S.mapRef.view.k, 0.25); S.mapRef.dirty = true; } }, ic('map', 14), t('act.map')) : null,
      canAI ? h('button.btn.sm.ghost', { disabled: ad?.status === 'loading', 'data-testid': 'advise', 'data-fk': `${a.id}-adv`, onclick: () => advise(a) }, ic('sparkle', 14), ad?.status === 'loading' ? t('computing') : t('ai.advise')) : null,
      !mayAct && S.me?.role !== 'viewer' && can('action.transition') ? h('span.xs.faint', t('act.outside')) : null,
      inc && inc.src !== 'sim' ? h('span.badge', t(`src.${inc.src}`)) : inc ? h('span.badge', t('src.sim')) : null),
    ad?.status === 'done' ? aiResult(ad.data) : ad?.status === 'error' ? aiError(ad.err) : null);
}
export const actionSig = (a) => [a.state, a.escalated, a.pending, a.pri, S.lang, can('action.transition'), canActOn(a.stn), advice.get(a.id)?.status, advice.get(a.id)?.data?.text?.length, quotaOut, S.sel?.e === a.e && S.sel?.t === 'edge', !!S.result, a.e >= 0 && S.result ? S.result.vc[a.e].toFixed(1) : '', aiAvailable()].join('|');

export function createActions() {
  const root = h('div.cc-body'), head = h('div.cc-sec'), seg = h('div.seg', { role: 'group', 'aria-label': t('act.filter') }), list = h('div.cc-actlist', { 'data-testid': 'action-list' }), empty = h('div');
  root.append(head, list, empty);
  function update() {
    quotaOut = quotaOut && S.quota ? S.quota.used >= S.quota.limit : quotaOut;
    const all = S.actions.filter((a) => inScope(a.region)), open = all.filter((a) => a.state !== 'cleared');
    const items = (filter === 'open' ? open : all).slice().sort((a, b) => (b.escalated - a.escalated) || (b.raisedAt - a.raisedAt));
    fill(seg, ...['open', 'all'].map((f) => h('button', { 'aria-pressed': String(filter === f), onclick: () => { filter = f; update(); } }, t(`act.f.${f}`))));
    fill(head, h('div', h('h2', t('tab.actions')), h('div.xs.faint', t('act.count', { n: open.filter((a) => a.state !== 'done').length, e: open.filter((a) => a.escalated).length }))), seg);
    reconcile(list, items, (a) => a.id, actionSig, actionCard);
    fill(empty, ...(items.length ? [] : [S.conn.loaded ? emptyState(t('act.none'), t('act.noneHint')) : h('div.stack', h('div.skel', { style: { height: '90px' } }), h('div.skel', { style: { height: '90px' } }))]));
    if (S.me?.role === 'viewer') empty.append(h('p.sm.muted', { style: { textAlign: 'center' } }, t('role.readonly')));
  }
  return { el: root, update, topics: ['actions', 'view', 'me', 'lang', 'quota', 'result', 'incidents'] };
}
export { advice };
