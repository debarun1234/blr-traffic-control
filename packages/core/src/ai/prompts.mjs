/** Context sanitisation + prompt builders. Only non-personal operational facts reach a model. */
const CTRL = /[\u0000-\u001f\u007f]/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g, PHONE = /(\+?\d[\d\s-]{8,}\d)/g;
export const scrub = (s, n = 200) => String(s ?? '').replace(EMAIL, '[email]').replace(PHONE, '[number]').replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : undefined);
const A = {
  action_advice: (c) => ({
    type: scrub(c.type, 20), title: scrub(c.title), road: scrub(c.road, 80), station: scrub(c.station, 60), region: scrub(c.region, 20), pri: scrub(c.pri, 4), incType: scrub(c.incType, 40),
    cap: num(c.cap), endHour: num(c.endHour), vc: num(c.vc), speed: num(c.speed), hour: num(c.hour), simulated: !!c.simulated, mode: scrub(c.mode, 8),
    alternates: c.alternates ? { roads: (c.alternates.roads ?? []).slice(0, 4).map((r) => scrub(r, 80)), extraKm: num(c.alternates.extraKm) } : null, ...(c.question ? { question: scrub(c.question, 200) } : {}),
  }),
  translate_kn: (c) => ({ text: scrub(c.text, 600) }),
  works_clash: (c) => ({
    simulated: !!c.simulated, hour: num(c.hour),
    works: (c.works ?? []).slice(0, 15).map((w) => ({ name: scrub(w.name, 80), road: scrub(w.road, 80), stations: (w.stations ?? []).slice(0, 4).map((s) => scrub(s, 60)), from: scrub(w.from, 10), to: scrub(w.to, 10), hours: scrub(w.hours, 6), cap: num(w.cap) })),
    incidents: (c.incidents ?? []).slice(0, 15).map((i) => ({ type: scrub(i.type, 40), road: scrub(i.road, 80), station: scrub(i.station, 60), endHour: num(i.endHour) })),
  }),
  brief: (c) => ({ ...c }),
};
export const cleanContext = (kind, raw) => A[kind](raw ?? {});
const J = (o) => JSON.stringify(o);
const RULES = 'Plain text only, no markdown fences, no tables. Be concise and specific. Never invent road names that are not in the data. If the data is marked simulated or modelled, say so in one short sentence. Do not include personal data.';
export function buildPrompt(kind, c) {
  switch (kind) {
    case 'action_advice': return `You assist a Bengaluru traffic control room operator. Give at most 5 short, practical numbered steps for the situation below, including a suggested alternate route if one is listed. ${c.question ? 'Also answer the operator question.' : ''}\n${RULES}\nSITUATION (JSON): ${J(c)}`;
    case 'translate_kn': return `Translate this operational traffic message into clear Kannada. Output only the Kannada translation, nothing else. Keep road names and numbers as they are.\nMESSAGE: ${c.text}`;
    case 'works_clash': return `Review these planned road works against active incidents and the demand peaks (about 07:00-11:00 and 16:00-21:00). List the clashes or risks in at most 6 short bullet lines and suggest a rescheduling or mitigation for each.\n${RULES}\nDATA (JSON): ${J(c)}`;
    case 'brief': return `Write a briefing for the Bengaluru traffic commissioner in under 150 words: current network state, the main trouble spots, what needs attention in the next hour. ${RULES}\nDATA (JSON): ${J(c)}`;
    default: throw new Error('unknown kind');
  }
}
/** Strip markdown fences/control chars and cap length. */
export function sanitiseOutput(t, max = 2500) {
  return String(t ?? '').replace(/```[a-zA-Z]*\n?/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
