/** Connector catalogue. One schema per type drives the create/edit form, validation and the integration guide. Pure data. */
export const EVENT_MAP = [['externalId', 'Unique id', true], ['type', 'Incident type', true], ['durationMin', 'Duration (min)', true], ['edge', 'Road edge index', false], ['lat', 'Latitude', false], ['lon', 'Longitude', false], ['startHour', 'Start hour (IST)', false], ['cap', 'Capacity left 0-1', false]];
export const SPEED_MAP = [['probeId', 'Probe id', true], ['minutes', 'Travel minutes', true], ['at', 'Observed at (epoch ms)', false]];
export const WORKS_MAP = [['name', 'Name', true], ['road', 'Road', true], ['station', 'Station', true], ['from', 'Start date', true], ['to', 'End date', true], ['hours', 'Hours (all/peak/night)', false], ['cap', 'Capacity left 0-1', false], ['kind', 'Kind', false], ['agency', 'Agency', false]];
export const MAPPINGS = { events: EVENT_MAP, speeds: SPEED_MAP, works: WORKS_MAP };
const TARGETS = [['events', 'Incidents / events'], ['speeds', 'Corridor speeds'], ['works', 'Road works']];

export const CONNECTOR_TYPES = {
  sim: { label: 'Built-in simulator', short: 'Simulator', blurb: 'Generates modelled traffic and incidents from the built-in demand model. Always available; use it as the fallback when live feeds are stale.', needs: ['Nothing to configure.'], secret: 'none', paid: false, fields: [] },
  rest: { label: 'REST / JSON poll', short: 'REST poll', blurb: 'The platform calls an HTTPS JSON endpoint on a schedule (for example an ASTraM, ANPR or BATCS export API) and maps its fields onto incidents, speeds or works.',
    needs: ['An HTTPS URL returning JSON', 'The JSON path of the array of records', 'A field mapping (which response field is which)', 'Optional: a Secret Manager secret holding header values (API tokens)'], secret: 'optional', paid: false,
    fields: [
      { key: 'target', label: 'Data kind', type: 'select', options: TARGETS, default: 'events', required: true },
      { key: 'url', label: 'Endpoint URL', type: 'url', required: true, ph: 'https://api.example.gov.in/v1/incidents', hint: 'HTTPS only. Do not put keys in the URL; use headers with a secret.' },
      { key: 'method', label: 'Method', type: 'select', options: [['GET', 'GET'], ['POST', 'POST']], default: 'GET' },
      { key: 'headerNames', label: 'Header names', type: 'tags', ph: 'Authorization', hint: 'Names only. Values come from the secret below, read as a JSON object keyed by header name.' },
      { key: 'itemsPath', label: 'Path to records array', type: 'text', ph: 'data.items', hint: 'Dot path into the response. Leave empty if the response is the array.' },
      { key: 'mapping', label: 'Field mapping', type: 'mapping', hint: 'Dot path in each record for each field. Leave optional fields empty.' }] },
  webhook: { label: 'Webhook (push)', short: 'Webhook', blurb: 'The external system pushes records to the /ingest/v1 endpoints with an API key. Nothing is polled; this entry records health and lets you disable or shadow the feed.',
    needs: ['An API key with the matching scope (create one under API keys)', 'The sender to POST JSON to /ingest/v1/events, /speeds or /works'], secret: 'none', paid: false,
    fields: [{ key: 'target', label: 'Data kind', type: 'select', options: TARGETS, default: 'events', required: true }, { key: 'sender', label: 'Sender name', type: 'text', ph: 'ANPR vendor', hint: 'Shown in the audit trail so you know who is pushing.' }] },
  csv: { label: 'CSV file / URL', short: 'CSV', blurb: 'Reads a CSV from a URL on a schedule, or accept one-off uploads from the Works and incidents page. Columns must match the import format.',
    needs: ['A URL to a CSV (HTTPS), or upload manually on the Works & incidents page', 'Column names as in the import spec'], secret: 'optional', paid: false,
    fields: [{ key: 'target', label: 'Data kind', type: 'select', options: [['works', 'Road works'], ['crash', 'Crash records']], default: 'works', required: true }, { key: 'url', label: 'CSV URL', type: 'url', required: false, ph: 'https://data.example.org/works.csv', hint: 'Leave empty for upload-only. Upload via Works & incidents.' }] },
  google_routes: { label: 'Google Routes API', short: 'Google Routes', blurb: 'Fetches live travel time for your probe corridors from the Google Routes API. Paid per call, so a daily cap is mandatory. Used to calibrate the model.',
    needs: ['A Secret Manager secret name holding the API key', 'A daily call cap', 'At least one probe corridor'], secret: 'required', paid: true,
    fields: [{ key: 'probeIds', label: 'Probe corridors', type: 'probes', required: true, hint: 'Each selected probe costs one call per run.' }, { key: 'trafficModel', label: 'Traffic model', type: 'select', options: [['BEST_GUESS', 'Best guess'], ['PESSIMISTIC', 'Pessimistic'], ['OPTIMISTIC', 'Optimistic']], default: 'BEST_GUESS' }] },
  tomtom: { label: 'TomTom Routing / Flow', short: 'TomTom', blurb: 'Fetches live travel time for probe corridors from TomTom. Paid per call with a free daily tier; the cap protects the budget.',
    needs: ['A Secret Manager secret name holding the API key', 'A daily call cap', 'At least one probe corridor'], secret: 'required', paid: true,
    fields: [{ key: 'probeIds', label: 'Probe corridors', type: 'probes', required: true, hint: 'Each selected probe costs one call per run.' }] },
  gba_works: { label: 'GBA / BMRCL works feed', short: 'Works feed', blurb: 'Imports planned road works and metro barricading from a Greater Bengaluru Authority or BMRCL export (CSV, JSON or GeoJSON) and keeps works in sync.',
    needs: ['The export URL', 'The agency name to stamp on imported works', 'Format of the export'], secret: 'optional', paid: false,
    fields: [{ key: 'url', label: 'Export URL', type: 'url', required: true, ph: 'https://gba.example.gov.in/works/export.json' }, { key: 'format', label: 'Format', type: 'select', options: [['json', 'JSON'], ['csv', 'CSV'], ['geojson', 'GeoJSON']], default: 'json' }, { key: 'agency', label: 'Agency', type: 'select', options: [['GBA', 'GBA'], ['BMRCL', 'BMRCL'], ['BBMP', 'BBMP (legacy)'], ['Other', 'Other']], default: 'GBA' }] },
  opencity_crash: { label: 'OpenCity / BTP crash records', short: 'Crash records', blurb: 'Imports yearly crash counts per police station from a published OpenCity or Bengaluru Traffic Police CSV, refreshing the crash layer.',
    needs: ['The CSV URL', 'Columns: station, year, fatal, nonfatal'], secret: 'none', paid: false,
    fields: [{ key: 'url', label: 'CSV URL', type: 'url', required: true, ph: 'https://data.opencity.in/dataset/…/crash.csv' }, { key: 'yearFilter', label: 'Only import from year', type: 'number', min: 2010, max: 2100, hint: 'Optional. Older rows are skipped.' }] },
};
export const TYPE_ORDER = ['sim', 'rest', 'webhook', 'csv', 'google_routes', 'tomtom', 'gba_works', 'opencity_crash'];

/** Validate a connector form value. Returns {field: message}. `probes` is the list of existing probe ids. */
export function validateConnectorForm(type, v, probeIds = []) {
  const T = CONNECTOR_TYPES[type], e = {};
  if (!T) { e.type = 'Unknown type.'; return e; }
  if (!v.name || v.name.trim().length < 3) e.name = 'Give it a name of at least 3 characters.';
  if (!Number.isInteger(v.intervalMin) || v.intervalMin < 1 || v.intervalMin > 1440) e.intervalMin = 'Whole minutes, 1 to 1440.';
  if (T.paid) { if (!Number.isInteger(v.dailyCap) || v.dailyCap < 1 || v.dailyCap > 100000) e.dailyCap = 'Paid connectors need a daily call cap (1 to 100,000).'; }
  else if (v.dailyCap != null && v.dailyCap !== '' && (!Number.isInteger(v.dailyCap) || v.dailyCap < 1)) e.dailyCap = 'Whole number of calls, or leave empty.';
  for (const f of T.fields) {
    const val = v.config?.[f.key];
    if (f.type === 'url') { if (val) { if (!/^https:\/\/[^\s/$.?#][^\s]*$/i.test(val)) e[f.key] = 'Must be a valid https:// URL.'; else if (/[?&](key|token|apikey|api_key|secret|password)=/i.test(val)) e[f.key] = 'Keys must not be in the URL. Use a header and a secret.'; } else if (f.required) e[f.key] = 'Required.'; }
    else if (f.type === 'probes') { if (f.required && !(val?.length)) e[f.key] = 'Pick at least one probe.'; else if (val?.some((p) => !probeIds.includes(p))) e[f.key] = 'A selected probe no longer exists.'; }
    else if (f.type === 'mapping') { const map = val ?? {}; const miss = MAPPINGS[v.config?.target ?? 'events'].filter(([k, , req]) => req && !String(map[k] ?? '').trim()).map((x) => x[1]); if (miss.length) e[f.key] = `Map required fields: ${miss.join(', ')}.`; if (v.config?.target === 'events' && !map.edge && !(map.lat && map.lon)) e[f.key] = (e[f.key] ? e[f.key] + ' ' : '') + 'Map either edge or both lat and lon.'; }
    else if (f.type === 'tags') { const bad = (val ?? []).find((t) => !/^[A-Za-z0-9-]{1,64}$/.test(t)); if (bad) e[f.key] = `"${bad}" is not a valid header name.`; }
    else if (f.type === 'number') { if (val != null && val !== '' && (!Number.isInteger(val) || val < f.min || val > f.max)) e[f.key] = `Whole number ${f.min} to ${f.max}.`; }
    else if (f.required && !val) e[f.key] = 'Required.';
  }
  return e;
}
