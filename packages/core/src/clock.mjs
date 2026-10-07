/** Clock injection. Everything time-dependent takes a clock `{now():number}` so tests are deterministic. */
export const systemClock = Object.freeze({ now: () => Date.now() });
/** @param {number} start epoch ms */
export function fixedClock(start) {
  let t = start;
  return { now: () => t, set(v) { t = v; }, advance(ms) { t += ms; return t; } };
}
