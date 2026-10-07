// AI output + error rendering. AI text is ALWAYS inserted with textContent (via h() text nodes), never as HTML.
import { h } from '/vendor/ui.mjs';
import { t } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { textBlocks } from '../util.mjs';

const TIER = { t0: 'ai.tier.t0', t1: 'ai.tier.t1', t2: 'ai.tier.t2', t3: 'ai.tier.t3' };
export function aiResult(data, { meta } = {}) {
  const blocks = textBlocks(data.text).map((b) => b.list ? h('ul.cc-ai-list', b.lines.map((l) => h('li', l))) : h('p', b.lines[0]));
  return h('div.cc-ai', { 'data-testid': 'ai-result' },
    h('div.cc-ai-h', h('span.cc-ai-tag', ic('sparkle', 13), t('ai.label')),
      h('span.badge' + (data.tier === 't0' ? '.info' : '.accent'), { title: t(`ai.tierHint.${data.tier}`), 'data-testid': 'ai-tier' }, t(TIER[data.tier] ?? 'ai.tier.t1')),
      data.cached ? h('span.badge', { 'data-testid': 'ai-cached' }, t('ai.cached')) : null, meta ?? null),
    h('div.cc-ai-b', blocks.length ? blocks : h('p', '')));
}
export function aiError(e) {
  const msg = e.code === 'quota_exceeded' ? t('ai.quotaOut') : e.code === 'rate_limited' ? t('ai.rate') : e.code === 'forbidden' ? t('err.forbidden') : e.network ? t('err.network') : t('ai.unavailable');
  return h('div.banner.bad.sm', { role: 'alert', 'data-testid': 'ai-error' }, msg);
}
