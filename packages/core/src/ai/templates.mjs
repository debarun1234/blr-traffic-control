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

/** Tier-0 deterministic advice. No model call. */
export function adviceTemplate(c) {
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
