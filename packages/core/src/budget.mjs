import { createAudit } from './audit.mjs';
import { getSettings } from './settings.mjs';
import { PAID } from './connectors/types.mjs';

/** Parse a billing-budget notification (Pub/Sub push envelope or the bare payload). Returns {costAmount,budgetAmount}|null. */
export function parseBudgetMessage(body) {
  let p = body;
  try { if (body?.message?.data) p = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')); } catch { return null; }
  const c = Number(p?.costAmount), b = Number(p?.budgetAmount);
  return Number.isFinite(c) && Number.isFinite(b) && b > 0 ? { costAmount: c, budgetAmount: b } : null;
}
/** When spend >= budget: disable AI and paid connectors, audit `budget_kill`. Idempotent. */
export async function applyBudget({ store, clock }, { costAmount, budgetAmount }) {
  const ratio = costAmount / budgetAmount;
  if (ratio < 1) return { killed: false, ratio };
  const audit = createAudit({ store, clock }), s = await getSettings(store), reason = `Budget exceeded (${costAmount}/${budgetAmount})`;
  await store.set('settings', 'app', { ...s, ai: { ...s.ai, enabled: false, killReason: reason } });
  const disabled = [];
  for (const c of await store.list('connectors', { where: [['enabled', '==', true]] })) if (PAID.includes(c.type)) { await store.update('connectors', c.id, { enabled: false, disabledReason: 'budget kill' }); disabled.push(c.id); }
  await audit.write({ actor: 'system', kind: 'budget_kill', target: 'settings/app', summary: reason, meta: { ratio, disabledConnectors: disabled } });
  return { killed: true, ratio, disabledConnectors: disabled };
}
