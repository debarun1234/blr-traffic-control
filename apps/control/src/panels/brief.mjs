// Commissioner / admin daily briefing card (POST /api/ai/brief).
import { h, fmtTime } from '/vendor/ui.mjs';
import { fill } from '../util.mjs';
import { S, on, can } from '../state.mjs';
import { aiBrief, aiAvailable } from '../feed.mjs';
import { t } from '../i18n.mjs';
import { ic } from '../icons.mjs';
import { aiResult, aiError } from './ai.mjs';
import { scopeLabel } from './common.mjs';

export function createBriefCard() {
  const el = h('div.card.cc-brief', { 'data-testid': 'brief' }); const store = new Map(); let busy = false, err = null;
  const key = () => (S.scope === 'All' ? 'city' : S.scope);
  async function run() {
    busy = true; err = null; render(); const k = key();
    try { store.set(k, await aiBrief(k)); } catch (e) { err = e; } finally { busy = false; render(); }
  }
  function render() {
    const show = can('ai.brief') && aiAvailable(); el.hidden = !show; if (!show) return;
    const d = store.get(key());
    fill(el, 
      h('div.card-h', h('div', h('h2', { style: { fontSize: '14px' } }, t('brief.title')), h('div.xs.faint', t('brief.scope', { scope: scopeLabel() }))),
        h('button.btn.sm' + (d ? '' : '.primary'), { disabled: busy, onclick: run, 'data-testid': 'brief-run' }, ic('sparkle', 14), busy ? t('computing') : d ? t('brief.refresh') : t('brief.generate'))),
      busy && !d ? h('div.stack', h('div.skel', { style: { height: '14px' } }), h('div.skel', { style: { height: '14px', width: '80%' } })) : null,
      err ? aiError(err) : null,
      d ? aiResult(d, { meta: d.generatedAt ? h('span.xs.faint', t('brief.at', { time: fmtTime(d.generatedAt) })) : null }) : (!busy && !err ? h('p.sm.muted', t('brief.hint')) : null));
  }
  on(['view', 'me', 'quota', 'lang'], render); render();
  return el;
}
