import { fmtHour } from '../incidents.mjs';
const STEPS = {
  Accident: ['Dispatch the nearest patrol unit and request a tow/recovery vehicle.', 'Keep one lane open and move vehicles to the shoulder as soon as the police confirm.'],
  'Vehicle breakdown': ['Send a tow vehicle; ask the driver to move to the kerb if safe.', 'Station a marshal upstream to merge traffic.'],
  Waterlogging: ['Request a pump team from the civic body and place barricades at the deepest point.', 'Divert light vehicles first; keep the road open for high-clearance vehicles only if depth is safe.'],
  Procession: ['Agree the route and timing with the organisers and barricade the lane edge.', 'Place marshals at the junctions on both sides and publish the diversion.'],
  'Signal fault': ['Send a signal technician and take manual control of the junction.', 'Use the peak-hour phase plan, favouring the heavier approach.'],
  'Tree fall': ['Call the tree-cutting crew and the electricity utility if lines are down.', 'Cone off the affected lane and divert from the previous junction.'],
};
const GENERIC = { cong: ['Put a marshal on the main junction upstream and extend the green on the heavy approach.', 'Clear any kerb-side parking or standing vehicles on the corridor.'], work: ['Confirm barricading and signage with the works agency before the peak.', 'Check that lane closure hours match the approved window.'], inc: ['Dispatch the nearest unit to confirm the situation on the ground.', 'Publish a short advisory on the corridor.'] };

// Kannada (ಕನ್ನಡ) versions of the tier-0 templates. Road/station names stay as in the data.
const STEPS_KN = {
  Accident: ['ಹತ್ತಿರದ ಗಸ್ತು ವಾಹನವನ್ನು ಕಳುಹಿಸಿ ಮತ್ತು ಟೋವಿಂಗ್/ರಿಕವರಿ ವಾಹನವನ್ನು ಕೋರಿ.', 'ಒಂದು ಪಥವನ್ನು ತೆರೆದಿಡಿ; ಪೊಲೀಸರು ಖಚಿತಪಡಿಸಿದ ತಕ್ಷಣ ವಾಹನಗಳನ್ನು ರಸ್ತೆಯ ಬದಿಗೆ ಸರಿಸಿ.'],
  'Vehicle breakdown': ['ಟೋವಿಂಗ್ ವಾಹನವನ್ನು ಕಳುಹಿಸಿ; ಸುರಕ್ಷಿತವಾಗಿದ್ದರೆ ಚಾಲಕರಿಗೆ ವಾಹನವನ್ನು ರಸ್ತೆ ಅಂಚಿಗೆ ಸರಿಸಲು ತಿಳಿಸಿ.', 'ಸಂಚಾರ ಸರಾಗವಾಗಿ ಸೇರುವಂತೆ ಮೇಲ್ಭಾಗದಲ್ಲಿ ಒಬ್ಬ ಮಾರ್ಷಲ್ ಅನ್ನು ನಿಲ್ಲಿಸಿ.'],
  Waterlogging: ['ನಾಗರಿಕ ಸಂಸ್ಥೆಯಿಂದ ಪಂಪ್ ತಂಡವನ್ನು ಕೋರಿ ಮತ್ತು ಅತಿ ಆಳದ ಸ್ಥಳದಲ್ಲಿ ಬ್ಯಾರಿಕೇಡ್ ಇರಿಸಿ.', 'ಮೊದಲು ಲಘು ವಾಹನಗಳನ್ನು ತಿರುಗಿಸಿ; ನೀರಿನ ಆಳ ಸುರಕ್ಷಿತವಾಗಿದ್ದರೆ ಮಾತ್ರ ಎತ್ತರದ ವಾಹನಗಳಿಗೆ ರಸ್ತೆ ತೆರೆದಿಡಿ.'],
  Procession: ['ಆಯೋಜಕರೊಂದಿಗೆ ಮಾರ್ಗ ಮತ್ತು ಸಮಯವನ್ನು ನಿಗದಿಪಡಿಸಿ ಮತ್ತು ಪಥದ ಅಂಚಿನಲ್ಲಿ ಬ್ಯಾರಿಕೇಡ್ ಹಾಕಿ.', 'ಎರಡೂ ಬದಿಯ ಜಂಕ್ಷನ್‌ಗಳಲ್ಲಿ ಮಾರ್ಷಲ್‌ಗಳನ್ನು ನಿಲ್ಲಿಸಿ ಮತ್ತು ಬದಲಿ ಮಾರ್ಗವನ್ನು ಪ್ರಕಟಿಸಿ.'],
  'Signal fault': ['ಸಿಗ್ನಲ್ ತಂತ್ರಜ್ಞರನ್ನು ಕಳುಹಿಸಿ ಮತ್ತು ಜಂಕ್ಷನ್ ಅನ್ನು ಹಸ್ತಚಾಲಿತವಾಗಿ ನಿಯಂತ್ರಿಸಿ.', 'ದಟ್ಟಣೆ ಹೆಚ್ಚಿರುವ ಕಡೆಗೆ ಆದ್ಯತೆ ನೀಡುವ ಪೀಕ್-ಅವರ್ ಹಂತ ಯೋಜನೆಯನ್ನು ಬಳಸಿ.'],
  'Tree fall': ['ಮರ ಕತ್ತರಿಸುವ ತಂಡವನ್ನು ಕರೆಯಿರಿ; ವಿದ್ಯುತ್ ತಂತಿಗಳು ಬಿದ್ದಿದ್ದರೆ ವಿದ್ಯುತ್ ಇಲಾಖೆಗೆ ತಿಳಿಸಿ.', 'ಬಾಧಿತ ಪಥವನ್ನು ಕೋನ್‌ಗಳಿಂದ ಮುಚ್ಚಿ ಮತ್ತು ಹಿಂದಿನ ಜಂಕ್ಷನ್‌ನಿಂದಲೇ ವಾಹನಗಳನ್ನು ತಿರುಗಿಸಿ.'],
};
const GENERIC_KN = {
  cong: ['ಮೇಲ್ಭಾಗದ ಮುಖ್ಯ ಜಂಕ್ಷನ್‌ನಲ್ಲಿ ಒಬ್ಬ ಮಾರ್ಷಲ್ ಅನ್ನು ನಿಲ್ಲಿಸಿ ಮತ್ತು ದಟ್ಟಣೆ ಹೆಚ್ಚಿರುವ ಕಡೆಗೆ ಹಸಿರು ಸಿಗ್ನಲ್ ಅವಧಿ ಹೆಚ್ಚಿಸಿ.', 'ಕಾರಿಡಾರ್‌ನಲ್ಲಿ ರಸ್ತೆ ಬದಿ ನಿಲ್ಲಿಸಿದ ಅಥವಾ ನಿಂತಿರುವ ವಾಹನಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ.'],
  work: ['ಪೀಕ್ ಸಮಯದ ಮೊದಲು ಕಾಮಗಾರಿ ಏಜೆನ್ಸಿಯೊಂದಿಗೆ ಬ್ಯಾರಿಕೇಡಿಂಗ್ ಮತ್ತು ಸೂಚನಾ ಫಲಕಗಳನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.', 'ಪಥ ಮುಚ್ಚುವ ಸಮಯವು ಅನುಮೋದಿತ ಅವಧಿಗೆ ಹೊಂದಿಕೆಯಾಗುತ್ತದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.'],
  inc: ['ಸ್ಥಳದ ಪರಿಸ್ಥಿತಿಯನ್ನು ಖಚಿತಪಡಿಸಲು ಹತ್ತಿರದ ತಂಡವನ್ನು ಕಳುಹಿಸಿ.', 'ಕಾರಿಡಾರ್‌ಗೆ ಸಂಬಂಧಿಸಿದ ಒಂದು ಸಣ್ಣ ಸೂಚನೆಯನ್ನು ಪ್ರಕಟಿಸಿ.'],
};
function adviceTemplateKn(c) {
  const where = [c.road, c.station].filter(Boolean).join(', ');
  const lines = [`${c.title || 'ಪರಿಸ್ಥಿತಿ'}${where ? ` (${where})` : ''}.`];
  if (c.vc != null) lines.push(`ಮಾದರಿ ಲೋಡ್ ಸಾಮರ್ಥ್ಯದ ${c.vc.toFixed(2)} ಪಟ್ಟು${c.speed != null ? `, ಸುಮಾರು ${c.speed} ಕಿಮೀ/ಗಂ` : ''}.`);
  if (c.cap != null && c.endHour != null) lines.push(`${fmtHour(c.endHour)} ವರೆಗೆ ಸಾಮರ್ಥ್ಯ ಶೇ ${Math.round(c.cap * 100)} ರಷ್ಟು ಇರಲಿದೆ ಎಂದು ಮಾದರಿ ಅಂದಾಜಿಸಿದೆ.`);
  const steps = [...(STEPS_KN[c.incType] ?? GENERIC_KN[c.type] ?? GENERIC_KN.inc)];
  if (c.alternates?.roads?.length) steps.push(`${c.alternates.roads.join(' ನಂತರ ')} ಮೂಲಕ ತಿರುಗಿಸಿ (ಸುಮಾರು ${c.alternates.extraKm} ಕಿಮೀ ಹೆಚ್ಚು).`);
  else steps.push('ರಸ್ತೆ ಜಾಲದಲ್ಲಿ ಸ್ಪಷ್ಟ ಬದಲಿ ರಸ್ತೆ ಕಂಡುಬಂದಿಲ್ಲ; ಮೇಲ್ಭಾಗದಲ್ಲೇ ಸಂಚಾರವನ್ನು ತಡೆಹಿಡಿಯುವುದನ್ನು ಪರಿಗಣಿಸಿ.');
  if (c.vc != null && c.vc >= 1.2) steps.push('ಲೋಡ್ ಸಾಮರ್ಥ್ಯಕ್ಕಿಂತ ಬಹಳ ಹೆಚ್ಚಿದೆ: ಸರತಿ ಪಕ್ಕದ ಜಂಕ್ಷನ್‌ಗಳಿಗೆ ಹರಡುವ ನಿರೀಕ್ಷೆ ಇದೆ.');
  lines.push(...steps.map((x, i) => `${i + 1}. ${x}`));
  lines.push(c.simulated ? 'ಸೂಚನೆ: ಈ ಸನ್ನಿವೇಶ ಮತ್ತು ಅಂಕಿಅಂಶಗಳು ಅನುಕರಣೆ/ಮಾದರಿ, ಅಳತೆ ಮಾಡಿದ್ದಲ್ಲ.' : 'ಸೂಚನೆ: ಅಂಕಿಅಂಶಗಳು ಮಾದರಿ ಅಂದಾಜುಗಳು, ನೇರ ಸೆನ್ಸರ್ ಅಳತೆಗಳಲ್ಲ.');
  return lines.join('\n');
}

/** Tier-0 deterministic advice. No model call. Kannada when c.lang === 'kn'. */
export function adviceTemplate(c) {
  if (c.lang === 'kn') return adviceTemplateKn(c);
  const where = [c.road, c.station].filter(Boolean).join(', ');
  const lines = [`${c.title || 'Situation'}${where ? ` (${where})` : ''}.`];
  if (c.vc != null) lines.push(`Modelled load ${c.vc.toFixed(2)} of capacity${c.speed != null ? `, about ${c.speed} km/h` : ''}.`);
  if (c.cap != null && c.endHour != null) lines.push(`Capacity is modelled at ${Math.round(c.cap * 100)}% until ${fmtHour(c.endHour)}.`);
  const steps = [...(STEPS[c.incType] ?? GENERIC[c.type] ?? GENERIC.inc)];
  if (c.alternates?.roads?.length) steps.push(`Divert via ${c.alternates.roads.join(' then ')} (about ${c.alternates.extraKm} km longer).`);
  else steps.push('No clear alternate road was found in the road graph; consider holding traffic upstream.');
  if (c.vc != null && c.vc >= 1.2) steps.push('Load is well above capacity: expect queues to spill back onto adjacent junctions.');
  lines.push(...steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push(c.simulated ? 'Note: this scenario and its figures are simulated/modelled, not measured.' : 'Note: figures are modelled estimates, not direct sensor measurements.');
  return lines.join('\n');
}
