/** Integration guide text per connector type. Pure. `base` is the origin that serves /ingest and /api. Keys are placeholders only. */
const KEY = '"x-api-key: $BLR_API_KEY"';
export function ingestExamples(base) {
  const hdr = `-H ${KEY} -H "content-type: application/json"`;
  return {
    events: { title: 'Push incidents', path: '/ingest/v1/events', scope: 'events', note: 'Idempotent on externalId: resending the same id updates, never duplicates. Use edge OR lat+lon (snapped to the nearest road within 150 m; rows further away are rejected).',
      curl: `curl -sS -X POST ${base}/ingest/v1/events \\\n  ${hdr} \\\n  -d '{"events":[{"externalId":"anpr-2026-10-07-0001","type":"breakdown","lat":12.9352,"lon":77.6245,"startHour":18.25,"durationMin":45,"cap":0.5}]}'`,
      resp: '{"accepted":1,"rejected":[]}' },
    speeds: { title: 'Push corridor travel times', path: '/ingest/v1/speeds', scope: 'speeds', note: 'probeId must exist under Traffic probes. minutes is the observed end-to-end travel time. at defaults to now (epoch ms).',
      curl: `curl -sS -X POST ${base}/ingest/v1/speeds \\\n  ${hdr} \\\n  -d '{"observations":[{"probeId":"orr-silkboard-hebbal","minutes":41.5}]}'`,
      resp: '{"accepted":1,"rejected":[]}' },
    works: { title: 'Push road works', path: '/ingest/v1/works', scope: 'works', note: 'Dates are YYYY-MM-DD. hours is all, peak or night. cap is the fraction of capacity left (0 = closed, 1 = unaffected).',
      curl: `curl -sS -X POST ${base}/ingest/v1/works \\\n  ${hdr} \\\n  -d '{"works":[{"name":"Metro Phase 3 barricading","road":"Outer Ring Road","stations":["K.R. Puram"],"from":"2026-10-15","to":"2026-12-31","hours":"peak","cap":0.7,"kind":"metro","agency":"BMRCL"}]}'`,
      resp: '{"accepted":1,"rejected":[]}' },
  };
}
const secretHow = (name) => `# Store the key in Secret Manager. The value never goes through this site.\nprintf %s "$YOUR_KEY" | gcloud secrets create ${name} --data-file=- --replication-policy=automatic\n# Then enter only the name "${name}" in the secretRef field.`;

/** Returns [{h, p?, code?, list?}] sections. */
export function guideFor(type, base) {
  const ex = ingestExamples(base); const out = [];
  const push = (h, o = {}) => out.push({ h, ...o });
  switch (type) {
    case 'webhook':
      push('How it works', { p: 'The sender calls our ingest endpoint with an API key. Create a key with only the scopes it needs on the API keys page, give it to the vendor, and they POST JSON.' });
      for (const k of ['events', 'speeds', 'works']) push(`${ex[k].title} (scope: ${ex[k].scope})`, { p: ex[k].note, code: ex[k].curl, after: `Response: ${ex[k].resp}` });
      push('Errors', { list: ['401: missing or revoked key', '403: key lacks the scope for this endpoint', '429: over the key rate limit; retry with backoff', 'rejected[] rows carry a reason; fix and resend only those rows'] });
      break;
    case 'rest':
      push('What the platform sends', { p: 'On each run it calls your URL with the headers you listed (values read from the secret), takes the array at "Path to records array", and maps each record with your field mapping.', code: `GET https://your-system.example.gov.in/v1/incidents?since=<last-run-iso>\nAuthorization: <value from secret>\nAccept: application/json` });
      push('Example response it can read', { code: `{ "data": { "items": [\n  { "id": "A-9912", "kind": "breakdown", "loc": { "lat": 12.9352, "lon": 77.6245 }, "mins": 45 }\n] } }`, after: 'Path to records array: data.items. Mapping: externalId=id, type=kind, lat=loc.lat, lon=loc.lon, durationMin=mins.' });
      push('Secret for header values', { p: 'A Secret Manager secret holding a JSON object keyed by header name.', code: `# secret "astram-headers" contains:\n{"Authorization":"Bearer <token>"}\n\n${secretHow('astram-headers')}` });
      push('Recommended rollout', { list: ['Create the connector in shadow mode.', 'Press Test: check the sample rows look right and the time is acceptable.', 'Run now and compare against the source system for a day.', 'Switch mode to live when satisfied.'] });
      break;
    case 'csv': push('CSV from a URL', { p: 'The file must have a header row. Works columns: name,road,station,from,to,hours,cap,kind,agency. Crash columns: station,year,fatal,nonfatal.', code: 'name,road,station,from,to,hours,cap,kind,agency\nMetro Phase 3 barricading,Outer Ring Road,K.R. Puram,2026-10-15,2026-12-31,peak,0.7,metro,BMRCL' });
      push('One-off upload', { p: 'Use Works & incidents to import a file with a dry run first. The same endpoint from a script:', code: `curl -sS -X POST "${base}/api/admin/import/works?dryRun=1" \\\n  -H "Authorization: Bearer $ID_TOKEN" -H "content-type: text/csv" \\\n  --data-binary @works.csv`, after: 'Response: {"accepted":12,"rejected":[{"row":4,"reason":"unknown station"}]}. Drop ?dryRun=1 to apply.' }); break;
    case 'google_routes': case 'tomtom':
      push('What it costs', { p: `Each run makes one ${type === 'tomtom' ? 'TomTom' : 'Google Routes'} request per selected probe. A run every 10 minutes across 6 probes is about 864 calls a day. The daily cap stops further calls once reached, and the global cap in Settings applies on top.` });
      push('Store the API key', { code: secretHow(type === 'tomtom' ? 'tomtom-key' : 'routes-key'), after: 'Grant the worker service account Secret Accessor on that secret. The Checks page confirms the secret resolves.' });
      push('What the platform requests', { code: type === 'tomtom' ? 'GET https://api.tomtom.com/routing/1/calculateRoute/{from}:{to}/json?traffic=true&key=<from secret>' : 'POST https://routes.googleapis.com/directions/v2:computeRoutes\nX-Goog-Api-Key: <from secret>\nX-Goog-FieldMask: routes.duration,routes.staticDuration' });
      push('Rollout', { list: ['Create the probes first (Traffic probes page).', 'Start in shadow mode with a low daily cap.', 'Watch the observations on the Probes page, then go live.'] }); break;
    case 'gba_works': push('Expected export', { p: 'JSON array, CSV or GeoJSON of planned works. Fields are matched by name; unknown stations are rejected with a reason in the run history.', code: `[{"name":"Storm-water drain, 80 Feet Road","road":"80 Feet Road","station":"Indiranagar","from":"2026-10-12","to":"2026-11-30","hours":"all","cap":0.6,"kind":"drain","agency":"GBA"}]` }); push('Behaviour', { list: ['Works are keyed by name + road + start date, so reruns update rather than duplicate.', 'Works missing from a later export are marked inactive, never deleted.'] }); break;
    case 'opencity_crash': push('Expected file', { p: 'CSV with station,year,fatal,nonfatal. Station names must match the 53 stations (Stations page lists them).', code: 'station,year,fatal,nonfatal\nHalasuru,2025,12,34\nIndiranagar,2025,9,41' }); push('Behaviour', { list: ['Replaces yearly counts per station; other years stay.', 'Rejected rows appear in run history with a reason.'] }); break;
    case 'sim': default: push('Nothing to integrate', { p: 'The simulator needs no configuration. Keep it enabled as the fallback so the map never goes blank when a live feed fails.' });
  }
  return out;
}
