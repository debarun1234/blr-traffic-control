// Data loading, polling and all server mutations. UI never calls fetch directly.
import { decodeState } from '/vendor/model.mjs';
import { S, emit, normAction, normIncident, applyResult, today, startTimeline, refreshReplay } from './state.mjs';

const EMPTY_ME = { permissions: [], jurisdiction: [], flags: { aiEnabled: false, maintenance: false }, lockedRegion: null };
let timer = null, running = false, ticks = 0, etag = null, inflight = null, lastTickAt = 0, authFails = 0;

export async function loadMe() {
  const r = await S.api.get('/me');
  const prev = S.me;
  S.me = { ...EMPTY_ME, ...r.data, flags: { ...EMPTY_ME.flags, ...(r.data.flags ?? {}) } };
  if (!prev || prev.role !== S.me.role || prev.station !== S.me.station || prev.region !== S.me.region || prev.flags?.maintenance !== S.me.flags.maintenance || prev.flags?.aiEnabled !== S.me.flags.aiEnabled) emit('me', 'view');
  return S.me;
}

function setGate(kind, extra) { S.gate = { kind, ...extra }; emit('gate'); }
function noteOk() { S.conn = { ...S.conn, ok: true, lastOk: Date.now(), fails: 0, loaded: true, error: null }; authFails = 0; emit('conn'); }
async function noteFail(e) {
  if (e.status === 401) {
    if (++authFails >= 2) return setGate('unauth');
    try { await S.auth.refresh(); } catch { /* handled next tick */ }
    return;
  }
  if (e.status === 403) return setGate('denied');
  if (e.status === 503 && /maintenance/i.test(e.message + JSON.stringify(e.extra ?? ''))) return setGate('maintenance');
  S.conn = { ...S.conn, ok: false, fails: S.conn.fails + 1, error: e.code }; emit('conn');
}

export async function refreshState() {
  const r = await S.api.get('/state', { etag });
  if (r.status === 304) return false;
  const st = r.data; etag = r.etag ?? null;
  const ne = S.MD.net.ne, n = st.net?.edges ?? ne;
  S.mapMismatch = n !== ne;
  const dec = !S.mapMismatch && st.vc && st.spd ? decodeState({ vc: st.vc, spd: st.spd, n }) : { vc: null, spd: null };
  const prevBoost = S.live?.boost;
  S.live = {
    t: st.t, hour: st.hour, date: st.date, mode: st.mode, boost: st.boost ?? 1, stale: !!st.stale, updatedAt: st.updatedAt ?? st.t,
    city: st.city ?? null, stations: st.stations ?? [], vc: dec.vc, spd: dec.spd, works: st.works ?? [], calibration: st.calibration ?? null,
    net: st.net ?? null, incidents: (st.incidents ?? []).map(normIncident),
  };
  applyResult(); emit('live', 'incidents');
  if (prevBoost == null || Math.abs(prevBoost - S.live.boost) > 1e-6) { startTimeline(); refreshReplay(); }
  return true;
}
export async function refreshActions() {
  const r = await S.api.get('/actions?state=all&limit=200');
  const local = new Map(S.actions.filter((a) => a.pending).map((a) => [a.id, a]));
  S.actions = (r.data.actions ?? []).map((a) => local.get(a.id) ?? normAction(a));
  emit('actions');
}
export async function refreshIncidents() {
  const r = await S.api.get(`/incidents?date=${encodeURIComponent(today())}`);
  S.incidents = (r.data.incidents ?? []).map(normIncident);
  emit('incidents'); refreshReplay();
}
export async function refreshWorks() {
  const r = await S.api.get('/works');
  S.works = (r.data.works ?? []).filter((w) => w.active !== false);
  emit('works'); refreshReplay();
}
export async function refreshCrash() {
  const r = await S.api.get('/crash'); S.crash = r.data; emit('crash');
}
export async function refreshQuota() {
  if (!aiAvailable(true)) return;
  try { const r = await S.api.get('/ai/quota'); S.quota = r.data; emit('quota'); } catch { /* quota is informational */ }
}
export const aiAvailable = (ignoreQuota = false) => !!S.me && S.me.flags?.aiEnabled !== false && (ignoreQuota || S.quota?.aiEnabled !== false) && (S.me.permissions.includes('ai.advise') || S.me.permissions.includes('ai.brief'));

async function tick(first = false) {
  if (inflight) return inflight;
  inflight = (async () => {
    lastTickAt = Date.now(); ticks++;
    const jobs = [refreshState(), refreshActions(), refreshWorks()];
    if (!S.crash) jobs.push(refreshCrash());
    if (!first && ticks % 4 === 0) jobs.push(loadMe().then(() => { if (S.me.flags.maintenance && S.me.role !== 'admin') setGate('maintenance'); }));
    const res = await Promise.allSettled(jobs);
    const inc = await Promise.allSettled([refreshIncidents()]);
    if (first || ticks % 2 === 0) refreshQuota();
    const bad = [...res, ...inc].find((x) => x.status === 'rejected');
    if (bad) await noteFail(bad.reason); else noteOk();
  })().finally(() => { inflight = null; });
  return inflight;
}
export const pollNow = () => tick();

export function startPolling() {
  if (running) return; running = true;
  const ms = S.cfg.pollMs ?? 30000;
  const loop = () => { clearTimeout(timer); if (!running) return; timer = setTimeout(async () => { if (!document.hidden) await tick(); loop(); }, ms); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running && Date.now() - lastTickAt > ms * 0.6) { tick(); loop(); } });
  tick(true).finally(loop);
}
export function stopPolling() { running = false; clearTimeout(timer); etag = null; }
export function resetFeed() { S.live = null; S.result = null; S.sum = null; S.actions = []; S.incidents = []; S.works = []; S.crash = null; S.quota = null; S.conn = { ok: true, lastOk: 0, fails: 0, loaded: false }; S.gate = null; ticks = 0; }

// ---- mutations ----
function patchAction(id, fn) { const a = S.actions.find((x) => x.id === id); if (a) fn(a); emit('actions'); return a; }
export async function transition(id, to, note) {
  const cur = S.actions.find((a) => a.id === id); if (!cur) return;
  const prev = cur.state;
  patchAction(id, (a) => { a.state = to; a.pending = true; });
  try {
    const r = await S.api.post(`/actions/${encodeURIComponent(id)}/transition`, note ? { to, note } : { to });
    patchAction(id, (a) => { Object.assign(a, normAction(r.data)); delete a.pending; });
  } catch (e) {
    patchAction(id, (a) => { a.state = prev; delete a.pending; });
    if (e.status === 409) refreshActions().catch(() => {});
    throw e;
  }
}
export async function reportIncident({ edge, type, durationMin, note }) {
  const r = await S.api.post('/incidents', { edge, type, durationMin, ...(note ? { note } : {}) });
  await Promise.allSettled([refreshIncidents(), refreshActions(), refreshState()]);
  return r.data;
}
export async function createWorks(w) { const r = await S.api.post('/works', w); await refreshWorks(); return r.data; }
export async function patchWorks(id, w) { const r = await S.api.patch(`/works/${encodeURIComponent(id)}`, w); await refreshWorks(); return r.data; }
export async function deleteWorks(id) {
  const prev = S.works; S.works = S.works.filter((w) => w.id !== id); emit('works');
  try { await S.api.del(`/works/${encodeURIComponent(id)}`); } catch (e) { S.works = prev; emit('works'); throw e; }
  await refreshWorks();
}
export async function aiAdvise(context) {
  try { const r = await S.api.post('/ai/advise', { kind: 'action_advice', context, lang: S.lang === 'kn' ? 'kn' : 'en' }); refreshQuota(); return r.data; }
  catch (e) { if (e.code === 'quota_exceeded') refreshQuota(); throw e; }
}
export async function aiBrief(scope) {
  try { const r = await S.api.post('/ai/brief', { scope, lang: S.lang === 'kn' ? 'kn' : 'en' }); refreshQuota(); return r.data; }
  catch (e) { if (e.code === 'quota_exceeded') refreshQuota(); throw e; }
}
