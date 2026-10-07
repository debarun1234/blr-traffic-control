import { h, toast, ago } from '../vendor/ui.mjs';
import { api, list, qs, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, mkField, input, select, toggle, errorSummary, validateFields, serverError, openDialog, confirmDialog, svg, fmtDT } from '../lib/kit.mjs';
import { mapCanvas, polyLayer, dotLayer, lineLayer, cssVar } from '../lib/mapview.mjs';
import { nearestNode, estimateFreeMin } from '../lib/logic.mjs';

export async function mount(root, ctx) {
  const map = ctx.map; const hubs = map.hubs, sts = map.st;
  const nodeXY = (n) => map.nxy[n];
  let probes = [], obs = new Map(), state = null;
  const host = h('div');
  root.append(pageHeader('Traffic probes', 'A probe is a corridor (from one point to another) whose real travel time is measured. Observations from connectors or the ingest API are compared with the model to calibrate it.', h('button.btn.primary', { id: 'add-probe', onclick: () => editDialog() }, '+ Add probe')), host);

  const reload = loader(host, async () => {
    const [p, o, s] = await Promise.all([api.get('/admin/probes').then((r) => list(r, 'probes')), api.get('/admin/probes/observations' + qs({ limit: 400 })).then((r) => list(r, ['observations', 'obs'])).catch(() => []), api.get('/state').catch(() => null)]);
    probes = p; state = s; obs = new Map(); for (const x of o) { if (!obs.has(x.probeId)) obs.set(x.probeId, []); obs.get(x.probeId).push(x); }
    for (const v of obs.values()) v.sort((a, b) => a.at - b.at);
    return view();
  });

  const spark = (pts, free) => { if (pts.length < 2) return h('span.faint', '-'); const W = 90, H = 24, mx = Math.max(...pts, free) * 1.1, mn = Math.min(...pts, free) * 0.9; const X = (i) => (i / (pts.length - 1)) * W, Y = (v) => H - ((v - mn) / (mx - mn)) * H;
    return svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Last ${pts.length} travel times, ${pts.at(-1)} minutes latest` }, svg('line', { x1: 0, x2: W, y1: Y(free), y2: Y(free), stroke: 'var(--line-2)', 'stroke-dasharray': '3 3' }), svg('polyline', { points: pts.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.6 })); };

  function view() {
    const cal = state?.calibration;
    const table = dataTable({ caption: 'Probes', cols: [
      { h: 'Corridor', cell: (p) => h('span', h('b', p.name), h('span.sub', `${p.fromLabel} to ${p.toLabel}`)) },
      { h: 'Free flow', cls: 'n', cell: (p) => `${p.freeMin} min` },
      { h: 'Latest', cls: 'n', cell: (p) => { const o = obs.get(p.id)?.at(-1); return o ? h('span', { title: fmtDT(o.at) }, `${(+o.minutes).toFixed(1)} min`, h('span.sub', ago(o.at) + ' · ' + o.source)) : h('span.faint', 'no data'); } },
      { h: 'Delay', cls: 'n', cell: (p) => { const o = obs.get(p.id)?.at(-1); if (!o) return h('span.faint', '-'); const r = o.minutes / p.freeMin; return h('span.badge' + (r > 2 ? '.bad' : r > 1.4 ? '.warn' : '.good'), `${r.toFixed(1)}x`); } },
      { h: 'Trend', cell: (p) => spark((obs.get(p.id) ?? []).slice(-24).map((o) => +o.minutes), p.freeMin) },
      { h: 'Weight', cls: 'n', cell: (p) => p.weight },
      { h: 'On', cell: (p) => { const t = toggle(p.enabled, `${p.enabled ? 'Disable' : 'Enable'} probe ${p.name}`, { onchange: async () => { try { await api.patch(`/admin/probes/${encodeURIComponent(p.id)}`, { enabled: t.input.checked }); toast(`${p.name} ${t.input.checked ? 'enabled' : 'disabled'}`, 'good'); reload(); } catch (e) { t.input.checked = !t.input.checked; toast(errMsg(e), 'bad'); } } }); return t; } },
      { h: 'Actions', cls: 'act', cell: (p) => h('span.row.nowrap', { style: { justifyContent: 'flex-end' } }, h('button.btn.sm', { 'aria-label': `Edit ${p.name}`, onclick: () => editDialog(p) }, 'Edit'), h('button.btn.sm.ghost', { 'aria-label': `Delete ${p.name}`, onclick: () => del(p) }, 'Delete')) },
    ], rows: probes, rowAttrs: (p) => ({ class: p.enabled ? '' : 'dim', dataset: { probe: p.name } }),
    empty: emptyState('No probes yet', 'Probes tell the platform how long real trips take on key corridors, so the model can be checked against reality.', h('button.btn.primary', { onclick: () => editDialog() }, '+ Add probe')) });
    const mp = mapCanvas(map, { ariaLabel: 'Map of probe corridors' }); mp.el.classList.add('static');
    mp.setLayers([polyLayer(sts.map((s) => s.poly), { stroke: () => cssVar('--line'), width: 0.8 }), ...probes.map((p) => lineLayer(nodeXY(p.fromNode), nodeXY(p.toNode), () => (p.enabled ? cssVar('--accent') : cssVar('--ink-3')))), dotLayer(probes.flatMap((p) => [nodeXY(p.fromNode), nodeXY(p.toNode)].map((n) => ({ x: n[0], y: n[1] }))), { r: 3.5, color: () => cssVar('--accent'), ring: true })]);
    setTimeout(() => mp.draw(), 0);
    const calCard = h('section.card', h('div.card-h', h('h2', 'Calibration')),
      cal ? h('dl.kv', h('dt', 'Model boost'), h('dd.mono', (state.boost ?? 1).toFixed(2) + 'x'), h('dt', 'Fit error (RMSE)'), h('dd', h('span.badge' + (cal.rmsePct <= 12 ? '.good' : cal.rmsePct <= 20 ? '.warn' : '.bad'), cal.rmsePct + '%')), h('dt', 'Probes used'), h('dd', cal.probes), h('dt', 'Calibrated'), h('dd', { title: fmtDT(cal.at) }, ago(cal.at))) : h('p.sm.muted', 'Not calibrated yet. Calibration needs observations from at least one enabled probe.'),
      h('p.xs.faint', { style: { marginTop: '10px' } }, 'Each tick the model predicts travel time on every enabled probe. The boost is a single city-wide multiplier on congestion, fitted so predictions match observations. RMSE is the typical miss after fitting: under about 12% is good, over 20% means a probe is wrong (check its endpoints and free-flow time) or the model needs retuning. Live mode still models every road; only probed corridors are measured.'));
    return h('div.stack', { style: { gap: '16px' } }, table.el, h('div.split', { style: { gridTemplateColumns: 'minmax(280px,400px) minmax(0,1fr)' } }, h('section.card', h('div.card-h', h('h2', 'Corridors on the map')), mp.el), calCard));
  }
  async function del(p) {
    if (!(await confirmDialog({ title: `Delete probe "${p.name}"?`, text: 'Connectors that list this probe will skip it. Its past observations are kept until they expire after 7 days.', ok: 'Delete probe', danger: true }))) return;
    try { await api.del(`/admin/probes/${encodeURIComponent(p.id)}`); toast(`Deleted ${p.name}`, 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad'); }
  }

  /* ---------- add / edit ---------- */
  function endpointOptions() { return [['', 'Choose a place'], ...[['Hubs', hubs.map((x, i) => [`hub:${i}`, x.n])], ['Police stations', [...sts].map((s, i) => [`st:${i}`, s.n]).sort((a, b) => a[1].localeCompare(b[1]))]].flatMap(([g, o]) => [['', `— ${g}`, true], ...o])]; }
  function resolve(v) { if (v.startsWith('hub:')) { const x = hubs[+v.slice(4)]; return { node: x.node, label: x.n }; } if (v.startsWith('st:')) { const x = sts[+v.slice(3)]; return { node: x.node, label: x.n }; } if (v.startsWith('node:')) { const n = +v.slice(5); const [x, y] = nodeXY(n); return { node: n, label: `Map point ${Math.round(x)},${Math.round(y)}` }; } return null; }
  function selectFor(sel, cur) { const el = h('select.select', endpointOptions().map(([v, l, dis]) => h('option', { value: v, disabled: dis ? true : null }, l))); if (cur) { el.append(h('option', { value: `node:${cur.node}` }, cur.label)); el.value = `node:${cur.node}`; } return el; }

  function editDialog(p) {
    const edit = !!p; const summary = errorSummary();
    const name = input({ value: p?.name ?? '', placeholder: 'e.g. Silk Board to Hebbal' });
    const from = selectFor(null, p && { node: p.fromNode, label: p.fromLabel }), to = selectFor(null, p && { node: p.toNode, label: p.toLabel });
    const free = input({ type: 'number', value: p?.freeMin ?? '', min: '1', max: '240', step: '0.5' }); const weight = input({ type: 'number', value: p?.weight ?? 1, min: '0.1', max: '5', step: '0.1' });
    let freeTouched = edit; free.addEventListener('input', () => (freeTouched = true));
    const ends = () => ({ a: resolve(from.value), b: resolve(to.value) });
    const suggest = () => { const { a, b } = ends(); const note = document.getElementById('free-suggest'); if (a && b) { const est = estimateFreeMin(nodeXY(a.node), nodeXY(b.node)); if (note) note.textContent = `Estimated from distance at 38 km/h: about ${est} min. Replace with the measured late-night travel time if you have it.`; if (!freeTouched) { free.value = est; } } };
    const fName = mkField('Name', name, { required: true, validate: (v) => (v.trim().length < 3 ? 'At least 3 characters.' : null) });
    const fFrom = mkField('From', from, { required: true, validate: (v) => (!v ? 'Choose a start point.' : null) });
    const fTo = mkField('To', to, { required: true, validate: (v) => (!v ? 'Choose an end point.' : v === from.value ? 'Start and end must differ.' : (ends().a && ends().b && ends().a.node === ends().b.node) ? 'Start and end resolve to the same road node.' : null) });
    const fFree = mkField('Free-flow minutes', free, { required: true, hint: 'Travel time with no traffic (late night).', validate: (v) => (+v >= 1 && +v <= 240 ? null : 'Between 1 and 240 minutes.') });
    const fWeight = mkField('Calibration weight', weight, { hint: 'How much this corridor counts when fitting the model. 1 is normal; main trunk corridors can be 2.', validate: (v) => (+v >= 0.1 && +v <= 5 ? null : 'Between 0.1 and 5.') });
    const enabled = toggle(p?.enabled ?? true, 'Enabled');
    // map picker
    let active = 'from'; const pick = h('div.seg', { role: 'group', 'aria-label': 'Which end the map click sets' }, ['from', 'to'].map((k) => h('button', { type: 'button', 'aria-pressed': String(k === active), onclick: (e) => { active = k; pick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, 'Set ' + k)));
    const mp = mapCanvas(map, { ariaLabel: 'Pick start and end on the map. Click to choose the nearest road node.', onPick: (x, y) => { const { node, dist } = nearestNode(map.nxy, x, y); const el = active === 'from' ? from : to; const opt = h('option', { value: `node:${node}` }, resolve(`node:${node}`).label); [...el.querySelectorAll('option[value^="node:"]')].forEach((o) => o.remove()); el.append(opt); el.value = opt.value; el.dispatchEvent(new Event('change')); } });
    const draw = () => { const { a, b } = ends(); const L = [polyLayer(sts.map((s) => s.poly), { stroke: () => cssVar('--line'), width: 0.8 }), dotLayer(hubs.filter((x) => x.node !== a?.node && x.node !== b?.node).map((x) => ({ x: x.x, y: x.y, label: x.n.split(',')[0].split(' (')[0] })), { r: 3, color: () => cssVar('--ink-3') })];
      if (a && b) L.push(lineLayer(nodeXY(a.node), nodeXY(b.node), () => cssVar('--accent'))); if (a) L.push(dotLayer([{ x: nodeXY(a.node)[0], y: nodeXY(a.node)[1], r: 6, label: 'From' }], { color: () => cssVar('--good'), ring: true })); if (b) L.push(dotLayer([{ x: nodeXY(b.node)[0], y: nodeXY(b.node)[1], r: 6, label: 'To' }], { color: () => cssVar('--bad'), ring: true })); mp.setLayers(L); };
    from.addEventListener('change', () => { suggest(); draw(); }); to.addEventListener('change', () => { suggest(); draw(); });
    const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary, h('div.split', h('div.stack', fName, fFrom, fTo, h('div.fgrid', fFree, fWeight), h('p.hint', { id: 'free-suggest' }), h('div.row', enabled, h('span.sm.muted', 'Enabled'))),
      h('div.stack', { style: { gap: '8px' } }, h('div.row.between', h('b.sm', 'Or click the map'), pick), mp.el, h('p.hint', 'A click snaps to the nearest routable road node.'))));
    openDialog({ title: edit ? `Edit probe: ${p.name}` : 'Add probe', size: 'xl', content, actions: [{ label: 'Cancel', value: null }, { label: edit ? 'Save changes' : 'Create probe', kind: 'primary', attrs: { id: 'probe-save' }, onClick: async () => {
      if (!validateFields([fName, fFrom, fTo, fFree, fWeight], summary)) return false; const { a, b } = ends();
      const body = { name: name.value.trim(), fromNode: a.node, toNode: b.node, fromLabel: a.label, toLabel: b.label, freeMin: +free.value, enabled: enabled.input.checked, weight: +weight.value };
      try { if (edit) await api.patch(`/admin/probes/${encodeURIComponent(p.id)}`, body); else await api.post('/admin/probes', body); } catch (x) { serverError(summary, x); return false; }
      toast(edit ? `Saved ${body.name}` : `Created ${body.name}`, 'good'); reload();
    } }] });
    setTimeout(() => { draw(); suggest(); }, 0);
  }
}
