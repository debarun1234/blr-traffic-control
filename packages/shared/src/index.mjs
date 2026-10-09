/** Roles, permissions and workflow rules shared by API, worker and both web apps. Pure, dependency-free. */

export const REGIONS = Object.freeze(['North', 'East', 'Central', 'West', 'South', 'Rural']);
export const ROLES = Object.freeze(['admin', 'commissioner', 'dcp', 'station', 'viewer']);
export const ACTION_STATES = Object.freeze(['new', 'ack', 'prog', 'done', 'cleared', 'persist']);
export const WORKFLOW = Object.freeze({ escalateAfterMin: 15, verifyAfterMin: 30, persistVcThreshold: 0.9 });

/** Allowed manual transitions. cleared/persist are written by the worker's verification step only. */
export const TRANSITIONS = Object.freeze({ new: ['ack'], ack: ['prog'], prog: ['done'], done: ['prog'], persist: ['prog'], cleared: [] });

export const PERMISSIONS = Object.freeze({
  admin: ['state.read', 'state.refresh', 'action.transition', 'incident.report', 'works.write', 'planner.run', 'ai.advise', 'ai.brief', 'admin.access'],
  commissioner: ['state.read', 'state.refresh', 'action.transition', 'incident.report', 'works.write', 'planner.run', 'ai.advise', 'ai.brief'],
  dcp: ['state.read', 'action.transition', 'incident.report', 'planner.run', 'ai.advise'],
  station: ['state.read', 'action.transition', 'incident.report', 'planner.run', 'ai.advise'],
  viewer: ['state.read'],
});

/** Which stations (by name) a user may act on. `stations` is map.json `st`: [{n, r}] */
export function jurisdiction(user, stations) {
  if (!user || user.active === false) return new Set();
  switch (user.role) {
    case 'admin': case 'commissioner': return new Set(stations.map((s) => s.n));
    case 'dcp': return new Set(stations.filter((s) => s.r === user.region).map((s) => s.n));
    case 'station': return new Set(stations.filter((s) => s.n === user.station).map((s) => s.n));
    default: return new Set();
  }
}

export function hasPermission(user, perm) {
  if (!user || user.active === false) return false;
  return (PERMISSIONS[user.role] ?? []).includes(perm);
}

/** Can `user` perform `perm` on something owned by station `stationName`? */
export function canOnStation(user, perm, stationName, stations) {
  return hasPermission(user, perm) && jurisdiction(user, stations).has(stationName);
}

/** The region a user's map is locked to, or null for city-wide roles. */
export function lockedRegion(user, stations) {
  if (!user) return null;
  if (user.role === 'dcp') return user.region ?? null;
  if (user.role === 'station') return stations.find((s) => s.n === user.station)?.r ?? null;
  return null;
}

/** Validate a stored user record. Returns an array of problems (empty = valid). */
export function validateUser(u, stations) {
  const p = [];
  if (!u || typeof u.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) p.push('email');
  if (!ROLES.includes(u?.role)) p.push('role');
  if (u?.role === 'dcp' && !REGIONS.includes(u.region)) p.push('region');
  if (u?.role === 'station' && !stations.some((s) => s.n === u.station)) p.push('station');
  return p;
}

export function normaliseEmail(e) { return String(e ?? '').trim().toLowerCase(); }

/** Deterministic action id for an incident so every writer derives the same id. */
export function actionIdFor(incidentId) { return `A-${incidentId}`; }

/** Pure state-machine check used by API and UI. */
export function canTransition(from, to) { return (TRANSITIONS[from] ?? []).includes(to); }

/** Minutes between two hours-of-day (floats). */
export const minutes = (h0, h1) => (h1 - h0) * 60;

/** IST helpers (UTC+5:30, no DST). */
export function istParts(ms = Date.now()) {
  const d = new Date(ms + 19800000);
  return { date: d.toISOString().slice(0, 10), h: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 };
}
