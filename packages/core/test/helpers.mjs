import { createMemoryStore, fixedClock, getNet } from '../src/index.mjs';
export const net = getNet();
/** 2026-10-07 09:00 IST (AM peak) */
export const T0 = Date.parse('2026-10-07T03:30:00Z');
export const mk = () => ({ store: createMemoryStore(), clock: fixedClock(T0), net });
