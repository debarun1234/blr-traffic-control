import { h, toast, ago } from '../vendor/ui.mjs';
import { REGIONS } from '../vendor/shared.mjs';
import { api, list, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, mkField, input, textarea, toggle, errorSummary, validateFields, serverError, openDialog, confirmDialog, readFile, download, debounce, fmtDT, select, busy } from '../lib/kit.mjs';
import { mapCanvas, polyLayer, dotLayer, cssVar } from '../lib/mapview.mjs';
import { lonLatToXY, xyToLonLat, BBOX, validateGeoJSON } from '../lib/logic.mjs';

const SRC = { 'osm-traffic': ['', 'OSM traffic police'], 'osm-ps': ['', 'OSM police station'], approx: ['warn', 'Approximate'] };

export async function mount(root, ctx) {
  const map = ctx.map; const names = map.st.map((s) => s.n);
  let ov = new Map(), crash = null, terr = null;
  let q = '', fRegion = '', onlyUnv = false;
  const host = h('div');
  root.append(pageHeader('Stations & territories', 'Police station coordinates and jurisdiction boundaries. Built-in values come from OpenStreetMap and are approximate; correct them here and tick Verified once you have checked against an official source.'), host);
  const reload = loader(host, async () => {
    const [s, t] = await Promise.all([api.get('/admin/stations'), api.get('/admin/territories').catch(() => ({}))]);
    ov = new Map(list(s, 'stations').map((x) => [x.name, x])); crash = s.crash ?? s.crashImport ?? null; terr = t?.territories ?? (t?.geojson ? t : null);
    return view();
  });
  const coord = (s) => { const o = ov.get(s.n); return o?.lat != null ? [o.lat, o.lon] : [xyToLonLat(s.x, s.y)[1], xyToLonLat(s.x, s.y)[0]]; };
  const isVerified = (s) => !!ov.get(s.n)?.verified;

  function view() {
    const tbl = h('div'); const count = h('span.muted.sm');
    const table = dataTable({ caption: 'Police stations', sort: { col: 0, dir: 1 }, cols: [
      { h: 'Station', sort: (s) => s.n, cell: (s) => h('span', h('b', s.n), ov.get(s.n)?.aliases?.length ? h('span.sub', 'aka ' + ov.get(s.n).aliases.join(', ')) : null) },
      { h: 'Region', sort: (s) => s.r, cell: (s) => s.r },
      { h: 'Division', sort: (s) => s.z, cell: (s) => s.z },
      { h: 'Coordinates', cls: 'n', cell: (s) => { const [la, lo] = coord(s); return `${la.toFixed(4)}, ${lo.toFixed(4)}`; } },
      { h: 'Source', sort: (s) => s.src, cell: (s) => { const [k, l] = SRC[s.src] ?? ['', s.src]; return ov.get(s.n)?.lat != null ? h('span.badge.accent', 'Admin override') : h('span.badge' + (k ? '.' + k : ''), l); } },
      { h: 'Status', sort: (s) => (isVerified(s) ? 1 : 0), cell: (s) => (isVerified(s) ? h('span.badge.good', 'Verified') : h('span.badge.warn', 'Unverified')) },
      { h: 'Actions', cls: 'act', cell: (s) => h('button.btn.sm', { 'aria-label': `Edit ${s.n}`, onclick: () => editDialog(s) }, 'Edit') },
    ], rowAttrs: (s) => ({ dataset: { station: s.n } }) });
    const apply = () => { const rows = map.st.filter((s) => (!q || s.n.toLowerCase().includes(q) || (ov.get(s.n)?.aliases ?? []).some((a) => a.toLowerCase().includes(q))) && (!fRegion || s.r === fRegion) && (!onlyUnv || !isVerified(s))); count.textContent = `${rows.length} of ${map.st.length}`; table.set(rows); };
    const search = input({ type: 'search', placeholder: 'Search stations', 'aria-label': 'Search stations', id: 'st-q', oninput: debounce(() => { q = search.value.trim().toLowerCase(); apply(); }, 100) });
    const reg = select([['', 'All regions'], ...REGIONS], fRegion, { id: 'st-reg', 'aria-label': 'Region', onchange: () => { fRegion = reg.value; apply(); } });
    const unv = h('input', { type: 'checkbox', id: 'st-unv', onchange: () => { onlyUnv = unv.checked; apply(); } });
    apply();
    const nVer = map.st.filter(isVerified).length;
    tbl.append(h('div.filters', h('div.field.grow', h('label', { for: 'st-q' }, 'Search'), search), h('div.field', h('label', { for: 'st-reg' }, 'Region'), reg), h('label.row', { for: 'st-unv', style: { paddingBottom: '8px' } }, unv, 'Unverified only'), h('div', { style: { paddingBottom: '8px' } }, count)), table.el);
    return h('div.stack', { style: { gap: '20px' } },
      h('div.stat-row', h('div.kpi' + (nVer < names.length ? '.warn' : '.good'), h('div.l', 'Verified stations'), h('div.v', `${nVer} / ${names.length}`), h('div.s', 'by an admin against an official source')),
        h('div.kpi', h('div.l', 'Approximate coordinates'), h('div.v', String(map.st.filter((s) => s.src === 'approx' && ov.get(s.n)?.lat == null).length)), h('div.s', 'guessed, not found in OSM')),
        h('div.kpi', h('div.l', 'Crash data'), h('div.v.sm2', crash?.importedAt ? ago(crash.importedAt) : 'built-in'), h('div.s', crash ? `${crash.source ?? 'import'} · ${crash.stations ?? ''} stations` : 'seed data 2018 to 2025'))),
      h('section', tbl), territoryCard());
  }

  /* ---------- station edit ---------- */
  function editDialog(s) {
    const o = ov.get(s.n) ?? {}; const [la0, lo0] = coord(s); const summary = errorSummary();
    const lat = input({ type: 'number', step: '0.0001', value: la0.toFixed(5) }), lon = input({ type: 'number', step: '0.0001', value: lo0.toFixed(5) });
    const aliases = input({ value: (o.aliases ?? []).join(', '), placeholder: 'Alternative spellings, comma separated' });
    const notes = textarea({ rows: 3, value: o.notes ?? '', placeholder: 'Source of the coordinates, who checked, caveats', style: { fontFamily: 'var(--font)', fontSize: '13px' } });
    const verified = toggle(!!o.verified, 'Verified');
    const fLat = mkField('Latitude', lat, { required: true, validate: (v) => (v !== '' && +v >= BBOX.lat[0] && +v <= BBOX.lat[1] ? null : `Between ${BBOX.lat[0]} and ${BBOX.lat[1]} (Bengaluru).`) });
    const fLon = mkField('Longitude', lon, { required: true, validate: (v) => (v !== '' && +v >= BBOX.lon[0] && +v <= BBOX.lon[1] ? null : `Between ${BBOX.lon[0]} and ${BBOX.lon[1]} (Bengaluru).`) });
    const fAl = mkField('Aliases', aliases, { hint: 'Used to match names in imported CSVs and feeds.' }); const fNotes = mkField('Notes', notes);
    const mp = mapCanvas(map, { ariaLabel: 'Click to move the station', onPick: (x, y) => { const [lo, la] = xyToLonLat(x, y); lat.value = la.toFixed(5); lon.value = lo.toFixed(5); lat.dispatchEvent(new Event('input')); draw(); } });
    const draw = () => { const [x, y] = lonLatToXY(+lon.value, +lat.value); mp.setLayers([polyLayer(map.st.map((t) => t.poly), { stroke: () => cssVar('--line'), width: 0.8 }), polyLayer([s.poly], { fill: () => cssVar('--accent-soft'), stroke: () => cssVar('--accent'), width: 1.4 }), ...(Number.isFinite(x) ? [dotLayer([{ x, y, r: 6 }], { color: () => cssVar('--bad'), ring: true })] : [])]); };
    lat.addEventListener('input', draw); lon.addEventListener('input', draw);
    const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary,
      h('p.sm.muted', `${s.r} region · ${s.z} division · built-in source: ${(SRC[s.src] ?? ['', s.src])[1]}`),
      h('div.split', h('div.stack', h('div.fgrid', fLat, fLon), fAl, fNotes, h('div.row', verified, h('span.sm', 'Verified against an official source'))), h('div.stack', { style: { gap: '6px' } }, mp.el, h('p.hint', 'Click the map to move the marker. The shaded area is the built-in boundary.'))));
    openDialog({ title: `Edit ${s.n}`, size: 'xl', content, actions: [{ label: 'Cancel', value: null }, { label: 'Save station', kind: 'primary', attrs: { id: 'station-save' }, onClick: async () => {
      if (!validateFields([fLat, fLon], summary)) return false;
      const body = { lat: +(+lat.value).toFixed(6), lon: +(+lon.value).toFixed(6), aliases: aliases.value.split(',').map((a) => a.trim()).filter(Boolean), notes: notes.value.trim(), verified: verified.input.checked };
      try { await api.patch(`/admin/stations/${encodeURIComponent(s.n)}`, body); } catch (e) { serverError(summary, e); return false; }
      toast(`Saved ${s.n}`, 'good'); reload();
    } }] });
    setTimeout(draw, 0);
  }

  /* ---------- territories ---------- */
  function ringsOf(g) { const out = []; for (const f of g?.features ?? []) { const t = f.geometry?.type; const parts = t === 'Polygon' ? [f.geometry.coordinates] : t === 'MultiPolygon' ? f.geometry.coordinates : []; out.push(parts.map((poly) => poly.map((ring) => ring.map(([lo, la]) => lonLatToXY(lo, la))))); } return out.flat(); }
  function builtinGeoJSON() { return { type: 'FeatureCollection', features: map.st.map((s) => ({ type: 'Feature', properties: { station: s.n, region: s.r }, geometry: { type: 'Polygon', coordinates: s.poly.map((ring) => ring.map(([x, y]) => xyToLonLat(x, y).map((v) => +v.toFixed(6)))) } })) }; }
  function territoryCard() {
    const mp = mapCanvas(map, { ariaLabel: 'Boundary preview' }); mp.el.classList.add('static');
    let pending = null; // {geojson, name, result}
    const result = h('div', { 'aria-live': 'polite' });
    const publish = h('button.btn.primary', { id: 'terr-publish', disabled: true, onclick: () => doPublish() }, 'Publish boundaries');
    const file = h('input', { type: 'file', id: 'terr-file', accept: '.geojson,.json,application/geo+json,application/json', class: 'sr', onchange: () => pickFile(file.files[0]) });
    const drop = h('div.dropzone', { onclick: () => file.click(), ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); pickFile(e.dataTransfer.files[0]); } },
      h('div', 'Drop a GeoJSON file here, or '), h('button.btn.sm', { type: 'button', style: { marginTop: '8px' }, onclick: (e) => { e.stopPropagation(); file.click(); } }, 'Choose file'), file, h('div.xs.faint', { style: { marginTop: '6px' } }, 'FeatureCollection of Polygon / MultiPolygon, WGS84 [lon, lat], each with properties.station'));
    const layers = () => { const L = [polyLayer(map.st.map((s) => s.poly), { stroke: () => cssVar('--ink-3'), width: 0.8, dash: [3, 3] })]; if (terr?.geojson && !pending) L.push(polyLayer(ringsOf(terr.geojson).map((r) => r), { fill: () => cssVar('--accent-soft'), stroke: () => cssVar('--accent'), width: 1.4 })); if (pending?.result && !pending.result.errors.length) L.push(polyLayer(ringsOf(pending.geojson), { fill: () => cssVar('--accent-soft'), stroke: () => cssVar('--accent'), width: 1.6 })); L.push(dotLayer(map.st.map((s) => ({ x: s.x, y: s.y })), { r: 2, color: () => cssVar('--ink-2') })); mp.setLayers(L); };
    async function pickFile(f) {
      if (!f) return; let g, text; result.replaceChildren(); pending = null; publish.disabled = true;
      try { text = await readFile(f); g = JSON.parse(text); } catch { result.replaceChildren(h('div.banner.bad', 'That file is not valid JSON.')); layers(); return; }
      const r = validateGeoJSON(g, names); pending = { geojson: g, name: f.name, result: r };
      result.replaceChildren(
        r.errors.length ? h('div.banner.bad', { role: 'alert' }, h('div', h('b', `${r.errors.length + (r.moreErrors ?? 0)} problem${r.errors.length > 1 ? 's' : ''} found. Nothing was sent.`), h('ul.ul', { style: { color: 'inherit' } }, r.errors.map((e) => h('li', e)), r.moreErrors ? h('li', `… and ${r.moreErrors} more`) : null))) : h('div.banner.info', `${f.name}: ${r.covered.length} stations, ${r.polys} polygon ring${r.polys === 1 ? '' : 's'}. Looks valid.`),
        ...r.warnings.map((w) => h('div.banner', { style: { marginTop: '6px' } }, w)));
      publish.disabled = !!r.errors.length; layers();
    }
    async function doPublish() {
      if (!(await confirmDialog({ title: 'Publish these boundaries?', text: `${pending.result.covered.length} station polygons from ${pending.name} replace the built-in approximate boundaries for those stations. Jurisdiction and region maps update on the next tick. You can revert to built-in at any time.`, ok: 'Publish' }))) return;
      await busy(publish, async () => { try { await api.put('/admin/territories', { geojson: pending.geojson }); toast('Boundaries published', 'good'); reload(); } catch (e) { result.replaceChildren(h('div.banner.bad', { role: 'alert' }, 'The server rejected the file: ' + errMsg(e))); } });
    }
    async function revert() {
      if (!(await confirmDialog({ title: 'Revert to built-in boundaries?', text: 'The uploaded official boundaries are removed and the approximate built-in ones are used again.', ok: 'Revert', danger: true }))) return;
      try { await api.del('/admin/territories'); toast('Reverted to built-in boundaries', 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad'); }
    }
    setTimeout(layers, 0);
    const cur = terr?.geojson;
    return h('section.card', { id: 'territories' }, h('div.card-h', h('h2', 'Territories (jurisdiction boundaries)'), cur ? h('span.badge.accent', 'Official boundaries active') : h('span.badge', 'Built-in approximate')),
      h('div.split', h('div.stack', h('p.sm.muted', cur ? `Uploaded by ${terr.uploadedBy} ${ago(terr.uploadedAt)} (${terr.source ?? 'upload'}), ${cur.features.length} polygons.` : 'No official boundaries uploaded. The map uses boundaries derived from the 2023 police-station list, which are approximate. Upload the official GeoJSON from BTP / GBA when you have it.'),
        drop, result, h('div.row', publish, cur ? h('button.btn', { id: 'terr-revert', onclick: revert }, 'Revert to built-in') : null, h('button.btn.ghost', { onclick: () => download('built-in-boundaries.geojson', JSON.stringify(builtinGeoJSON()), 'application/geo+json') }, 'Download built-in as template'))),
        h('div', mp.el, h('div.legend', { style: { marginTop: '8px' } }, h('span', h('i', { style: { background: 'var(--ink-3)' } }), 'Built-in (dashed)'), h('span', h('i', { style: { background: 'var(--accent)' } }), 'Uploaded / preview')))));
  }
}
