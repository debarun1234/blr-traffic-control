/** Context sanitisation + prompt builders. Only non-personal operational facts reach a model. */
const CTRL = /[\u0000-\u001f\u007f]/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g, PHONE = /(\+?\d[\d\s-]{8,}\d)/g;
export const scrub = (s, n = 200) => String(s ?? '').replace(EMAIL, '[email]').replace(PHONE, '[number]').replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : undefined);
const lang = (c) => (c?.lang === 'kn' ? 'kn' : 'en');
const A = {
  action_advice: (c) => ({
    lang: lang(c),
    type: scrub(c.type, 20), title: scrub(c.title), road: scrub(c.road, 80), station: scrub(c.station, 60), region: scrub(c.region, 20), pri: scrub(c.pri, 4), incType: scrub(c.incType, 40),
    cap: num(c.cap), endHour: num(c.endHour), vc: num(c.vc), speed: num(c.speed), hour: num(c.hour), simulated: !!c.simulated, mode: scrub(c.mode, 8),
    ageMin: num(c.ageMin), escalated: !!c.escalated, wf: scrub(c.wf, 10), stnSpeed: num(c.stnSpeed), stnCong: num(c.stnCong), peak: scrub(c.peak, 60),
    alternates: c.alternates ? { roads: (c.alternates.roads ?? []).slice(0, 4).map((r) => scrub(r, 80)), extraKm: num(c.alternates.extraKm) } : null, ...(c.question ? { question: scrub(c.question, 200) } : {}),
  }),
  translate_kn: (c) => ({ text: scrub(c.text, 600) }),
  works_clash: (c) => ({
    lang: lang(c), simulated: !!c.simulated, hour: num(c.hour),
    works: (c.works ?? []).slice(0, 15).map((w) => ({ name: scrub(w.name, 80), road: scrub(w.road, 80), stations: (w.stations ?? []).slice(0, 4).map((s) => scrub(s, 60)), from: scrub(w.from, 10), to: scrub(w.to, 10), hours: scrub(w.hours, 6), cap: num(w.cap) })),
    incidents: (c.incidents ?? []).slice(0, 15).map((i) => ({ type: scrub(i.type, 40), road: scrub(i.road, 80), station: scrub(i.station, 60), endHour: num(i.endHour) })),
  }),
  brief: (c) => ({ ...c, lang: lang(c) }),
};
export const cleanContext = (kind, raw) => A[kind](raw ?? {});
const J = (o) => JSON.stringify(o);
const RULES = 'Plain text only, no markdown fences, no tables, no bold. Be concise and specific. Never invent road names that are not in the data. If the data is marked simulated or modelled, say so in one short sentence. Do not include personal data.';
/** Output-language instruction. Names, numbers and times stay exactly as in the data. */
const LANG_KN = ' LANGUAGE: Write the entire answer in Kannada (ಕನ್ನಡ script). Keep road names, station names, numbers and times exactly as they appear in the data. Do not write English sentences.';
function basePrompt(kind, c) {
  switch (kind) {
    case 'action_advice': return `You are the duty officer's assistant in the Bengaluru traffic control room. The operator needs a specific plan for the situation below, not general advice.
Write: one line saying what is wrong and how bad it is (use the load, speed and how long it has been open, in the data's own numbers); then at most 5 numbered steps in the order they should be done. Each step says who does what and where (name the road, junction side or station from the data), and when it should happen (now, before the peak, by a stated time). If an alternate route is listed, say which traffic to send onto it and warn about what that does to the alternate. Finish with one line on what to check in 15 minutes to know it is working. If the data lacks something you would need (for example no alternate found), say so instead of guessing. Do not suggest 'deploy more personnel' without saying where.${c.question ? ' Also answer the operator question directly, first.' : ''}
${RULES}
SITUATION (JSON): ${J(c)}`;
    case 'translate_kn': return `Translate this operational traffic message into clear Kannada. Output only the Kannada translation, nothing else. Keep road names and numbers as they are.\nMESSAGE: ${c.text}`;
    case 'works_clash': return `Review these planned road works against active incidents and the demand peaks (about 07:00-11:00 and 16:00-21:00). List the clashes or risks in at most 6 short bullet lines and suggest a rescheduling or mitigation for each.\n${RULES}\nDATA (JSON): ${J(c)}`;
    case 'brief': return `You are the duty analyst briefing the Bengaluru traffic commissioner. Write 150 to 220 words as four short paragraphs with no headings, bullets or bold, in this order:
1. Overall: one or two sentences with the average speed and the share of roads congested, and whether this is simulated, modelled or live and whether the feed is stale.
2. Trouble spots: the worst roads and the station each is in, with their load figures, and any active incident or road works that explain them. Name the regions that are worst and best by speed.
3. Next hour: what needs attention, naming the specific road, station or open escalated action, and one concrete step each (who does what, where). Mention how long escalated actions have been waiting.
4. Outlook: one sentence on the next demand peak using the 'peak' field.
Start directly with paragraph 1: no greeting, no title and no date line. Use only facts in the data. If a list is empty, say that nothing is active instead of inventing something. Do not give generic advice that names no place. ${RULES}
DATA (JSON): ${J(c)}`;
    default: throw new Error('unknown kind');
  }
}
export const buildPrompt = (kind, c) => basePrompt(kind, c) + (kind !== 'translate_kn' && c?.lang === 'kn' ? `\n${LANG_KN.trim()}` : '');
/** Strip markdown fences/control chars and cap length. */
export function sanitiseOutput(t, max = 2500) {
  return String(t ?? '').replace(/```[a-zA-Z]*\n?/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
