/** Cross-page admin actions: settings read/write, AI kill switch, run checks. */
import { h, toast } from '../vendor/ui.mjs';
import { api } from './api.mjs';
import { mkField, textarea, errorSummary, validateFields, serverError, openDialog } from './kit.mjs';

export const getSettings = async () => { const r = await api.get('/admin/settings'); return r.settings ?? r; };
export const putSettings = async (s) => { const r = await api.put('/admin/settings', s); return r?.settings ?? r ?? s; };
export const runChecks = () => api.post('/admin/checks/run', {});

/** Dialog that requires a reason, then flips the AI kill switch. Resolves true when the server accepted it. */
export function aiSwitchDialog(turnOn) {
  const summary = errorSummary();
  const reason = textarea({ rows: 3, placeholder: turnOn ? 'e.g. Budget reviewed, cap raised to 2,000 calls/day' : 'e.g. Unexpected spend spike; investigating', style: { fontFamily: 'var(--font)', fontSize: '13px' } });
  const f = mkField('Reason (written to the audit log)', reason, { required: true, validate: (v) => (v.trim().length < 5 ? 'Give a reason of at least 5 characters.' : null) });
  const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary,
    h('p.muted', turnOn ? 'AI features resume for all users within a minute. Daily and per-user caps still apply.' : 'All AI calls stop immediately for every user: advice falls back to deterministic templates (tier t0) and the commissioner brief is unavailable. Nothing else is affected.'), f);
  return openDialog({ title: turnOn ? 'Turn AI back on' : 'Turn AI off (kill switch)', content, size: 'sm', actions: [{ label: 'Cancel', value: false },
    { label: turnOn ? 'Turn AI on' : 'Turn AI off', kind: turnOn ? 'primary' : 'danger', value: true, onClick: async () => {
      if (!validateFields([f], summary)) return false;
      try { await api.post('/admin/ai/kill', { enabled: turnOn, reason: reason.value.trim() }); } catch (e) { serverError(summary, e); return false; }
      toast(turnOn ? 'AI is on' : 'AI is off', 'good');
    } }] }).closed.then((v) => v === true);
}
