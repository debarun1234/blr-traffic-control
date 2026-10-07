// Shared building blocks for inspector panels.
import { h, fmtH } from '/vendor/ui.mjs';
import { S, curHour, lockedRegion } from '../state.mjs';
import { t, regionName, typeName } from '../i18n.mjs';

export const kpi = (label, value, { tone = '', sub = '', id } = {}) =>
  h('div.kpi' + (tone ? '.' + tone : ''), { dataset: id ? { kpi: id } : undefined }, h('div.l', label), h('div.v', value ?? '–'), sub ? h('div.s', sub) : null);
export const kpiSkeleton = (label) => h('div.kpi', h('div.l', label), h('div.skel', { style: { height: '30px', width: '60%', marginTop: '4px' } }));
export const sectionTitle = (text, right) => h('div.cc-sec', h('h3', text), right ?? null);
export const emptyState = (title, hint) => h('div.empty', h('div', { style: { fontWeight: 600, color: 'var(--ink-2)' } }, title), hint ? h('div.sm', { style: { marginTop: '4px' } }, hint) : null);
export const skeletonRows = (n = 4) => h('div.stack', { 'aria-busy': 'true', 'aria-label': t('loading') }, Array.from({ length: n }, () => h('div.skel', { style: { height: '34px' } })));

export function stateBadge(state) {
  const kind = { new: 'accent', ack: 'info', prog: 'warn', done: 'good', cleared: 'good', persist: 'bad' }[state] ?? '';
  return h('span.badge' + (kind ? '.' + kind : ''), t(`state.${state}`));
}
export const regionBadge = (r) => h('span.badge', regionName(r));
export const hourLabel = (hr) => `${fmtH(hr)} IST`;
export function scopeLabel() { return S.scope === 'All' ? t('scope.all') : regionName(S.scope); }
export const speedTag = (v, cls) => h('span.badge.speedtag', h('i.sw', { style: { background: `var(--c${cls})` } }), h('span.mono', `${Math.round(v)} km/h`));
export { typeName };
export function lockNote() { const lr = lockedRegion(); return lr ? h('p.sm.muted', t('lock.note', { region: regionName(lr) })) : null; }
export const timeNow = () => curHour();
