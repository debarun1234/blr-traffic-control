import { h, toast, ago } from '../vendor/ui.mjs';
import { ROLES, REGIONS, PERMISSIONS, validateUser, normaliseEmail } from '../vendor/shared.mjs';
import { api, list, errMsg } from '../lib/api.mjs';
import { pageHeader, loader, dataTable, emptyState, mkField, input, select, errorSummary, validateFields, serverError, openDialog, confirmDialog, roleBadge, fmtDT, debounce, busy } from '../lib/kit.mjs';

const ROLE_BLURB = { admin: 'Everything, including this site.', commissioner: 'Whole city; may write works and request the city brief.', dcp: 'One region; acts on stations in that region.', station: 'One station; sees its region map, acts only on its own station.', viewer: 'Read-only.' };
const PERM_LABEL = { 'state.read': 'View live state', 'action.transition': 'Acknowledge / progress / close actions', 'incident.report': 'Report incidents', 'works.write': 'Create and edit road works', 'planner.run': 'Use the planner', 'ai.advise': 'AI action advice', 'ai.brief': 'City AI brief', 'admin.access': 'Admin site' };
const isOnline = (u) => u.lastLogin && Date.now() - u.lastLogin < 15 * 60000;

export async function mount(root, ctx) {
  const stationNames = ctx.stations.map((s) => s.n).sort((a, b) => a.localeCompare(b));
  let users = [], q = '', fRole = '', fRegion = '', fStatus = 'active';
  const body = h('div');
  const addBtn = h('button.btn.primary', { onclick: () => userDialog() }, '+ Add user');
  root.append(pageHeader('Users & roles', 'Sign-in is allowlist-only: someone can use the platform only if their email is listed here and active. There is no self-registration.', addBtn));

  const tableHost = h('div'); const count = h('span.muted.sm');
  const search = input({ type: 'search', placeholder: 'Search name or email', 'aria-label': 'Search users', oninput: debounce(() => { q = search.value.trim().toLowerCase(); apply(); }, 120) });
  const roleSel = select([['', 'All roles'], ...ROLES], '', { 'aria-label': 'Filter by role', onchange: () => { fRole = roleSel.value; apply(); } });
  const regSel = select([['', 'All regions'], ...REGIONS], '', { 'aria-label': 'Filter by region', onchange: () => { fRegion = regSel.value; apply(); } });
  const stSel = select([['active', 'Active'], ['inactive', 'Deactivated'], ['', 'All']], 'active', { 'aria-label': 'Filter by status', onchange: () => { fStatus = stSel.value; apply(); } });
  const filters = h('div.filters', h('div.field.grow', h('label', { for: (search.id = 'u-q') }, 'Search'), search), h('div.field', h('label', { for: (roleSel.id = 'u-role') }, 'Role'), roleSel), h('div.field', h('label', { for: (regSel.id = 'u-reg') }, 'Region'), regSel), h('div.field', h('label', { for: (stSel.id = 'u-st') }, 'Status'), stSel), h('div', { style: { paddingBottom: '8px' } }, count));

  const regionOf = (u) => u.region ?? ctx.stations.find((s) => s.n === u.station)?.r ?? '';
  const table = dataTable({
    caption: 'Users', sort: { col: 0, dir: 1 },
    cols: [
      { h: 'User', sort: (u) => u.email, cell: (u) => h('span', h('b', u.name || u.email.split('@')[0]), u.email === ctx.me.email ? h('span.badge.accent', { style: { marginLeft: '6px' } }, 'You') : null, h('span.sub.mono', u.email)) },
      { h: 'Role', sort: (u) => u.role, cell: (u) => roleBadge(u.role) },
      { h: 'Scope', sort: (u) => u.station ?? u.region ?? '', cell: (u) => u.role === 'station' ? h('span', u.station, h('span.sub', regionOf(u) + ' region')) : u.role === 'dcp' ? u.region : h('span.faint', u.role === 'viewer' || u.role === 'admin' || u.role === 'commissioner' ? 'Whole city' : '-') },
      { h: 'Status', sort: (u) => (u.active ? 1 : 0), cell: (u) => u.active ? h('span.badge.good', 'Active') : h('span.badge', 'Deactivated') },
      { h: 'Last login', sort: (u) => u.lastLogin ?? 0, cell: (u) => u.lastLogin ? h('span', { title: fmtDT(u.lastLogin) }, isOnline(u) ? h('span.dot.good.live', { style: { marginRight: '6px' }, title: 'Signed in within 15 minutes' }) : null, ago(u.lastLogin)) : h('span.faint', 'Never') },
      { h: 'Actions', cls: 'act', cell: (u) => h('span.row.nowrap', { style: { justifyContent: 'flex-end' } },
        h('button.btn.sm', { 'aria-label': `Edit ${u.email}`, onclick: () => userDialog(u) }, 'Edit'),
        u.active ? h('button.btn.sm', { 'aria-label': `Deactivate ${u.email}`, onclick: () => deactivate(u) }, 'Deactivate') : h('button.btn.sm', { 'aria-label': `Reactivate ${u.email}`, onclick: () => reactivate(u) }, 'Reactivate')) },
    ],
    rowAttrs: (u) => ({ class: u.active ? '' : 'dim', dataset: { email: u.email } }),
  });
  tableHost.append(table.el);
  function apply() {
    const rows = users.filter((u) => (!q || u.email.includes(q) || (u.name ?? '').toLowerCase().includes(q)) && (!fRole || u.role === fRole) && (!fRegion || regionOf(u) === fRegion) && (!fStatus || (fStatus === 'active') === !!u.active));
    count.textContent = `${rows.length} of ${users.length} users`;
    table.set(rows);
    if (!rows.length) tableHost.firstChild.replaceWith(emptyState(users.length ? 'No users match these filters' : 'No users yet', users.length ? 'Clear a filter to see more.' : 'Add the first user to give someone access.', users.length ? null : h('button.btn.primary', { onclick: () => userDialog() }, '+ Add user'))); else if (tableHost.firstChild !== table.el) tableHost.firstChild.replaceWith(table.el);
  }
  const reload = loader(body, async () => {
    users = list(await api.get('/admin/users'), 'users'); apply();
    const admins = users.filter((u) => u.role === 'admin' && u.active).length;
    return h('div', filters, tableHost, h('p.faint.sm', { style: { marginTop: '8px' } }, `${admins} active admin${admins === 1 ? '' : 's'}. The server blocks demoting or deactivating yourself, and removing the last active admin.`));
  });
  root.append(body);

  /* ---- add / edit ---- */
  function userDialog(u) {
    const edit = !!u; const self = edit && u.email === ctx.me.email;
    const summary = errorSummary();
    const email = input({ type: 'email', value: u?.email ?? '', disabled: edit, placeholder: 'name@example.com', inputmode: 'email' });
    const name = input({ value: u?.name ?? '', placeholder: 'Display name (optional)' });
    const role = select(ROLES, u?.role ?? 'viewer');
    const region = select([['', 'Select region'], ...REGIONS], u?.region ?? '');
    const station = select([['', 'Select station'], ...stationNames], u?.station ?? '');
    const fEmail = mkField('Email', email, { required: true, hint: edit ? 'The email is the account key and cannot be changed. Create a new user instead.' : 'Must match the Google account they sign in with. Stored lower-case.', validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normaliseEmail(v)) ? null : 'Enter a valid email address.') });
    const fName = mkField('Name', name);
    const fRole = mkField('Role', role, { required: true });
    const fRegion = mkField('Region', region, { required: true, hint: 'A DCP acts on every station in this region.', validate: (v) => (role.value === 'dcp' && !REGIONS.includes(v) ? 'Choose the region for this DCP.' : null) });
    const fStation = mkField('Station', station, { required: true, hint: 'Station users act only on this station and see its region map.', validate: (v) => (role.value === 'station' && !stationNames.includes(v) ? 'Choose the station.' : null) });
    const blurb = h('p.hint', { 'aria-live': 'polite' });
    const sync = () => { fRegion.classList.toggle('hide', role.value !== 'dcp'); fStation.classList.toggle('hide', role.value !== 'station'); blurb.textContent = ROLE_BLURB[role.value]; };
    role.addEventListener('change', () => { sync(); fRegion.setError(null); fStation.setError(null); }); sync();
    const content = h('form.stack', { novalidate: true, onsubmit: (e) => e.preventDefault() }, summary,
      self ? h('div.banner.info', 'This is your own account. The server will not let you demote or deactivate yourself.') : null,
      fEmail, fName, h('div', fRole, blurb), fRegion, fStation);
    const d = openDialog({ title: edit ? `Edit ${u.email}` : 'Add user', content, size: '', actions: [
      { label: 'Cancel', value: null },
      { label: edit ? 'Save changes' : 'Add user', kind: 'primary', value: true, onClick: async () => {
        if (!validateFields([fEmail, fRole, fRegion, fStation].filter((f) => !f.classList.contains('hide')), summary)) return false;
        const body = { role: role.value };
        if (role.value === 'dcp') body.region = region.value; if (role.value === 'station') body.station = station.value;
        if (name.value.trim()) body.name = name.value.trim();
        const problems = validateUser({ email: normaliseEmail(email.value), ...body }, ctx.stations); if (problems.length) { summary.textContent = 'Invalid: ' + problems.join(', '); summary.classList.remove('hide'); return false; }
        try {
          if (edit) { if (role.value !== 'dcp') body.region = null; if (role.value !== 'station') body.station = null; await api.patch(`/admin/users/${encodeURIComponent(u.email)}`, body); toast(`Saved ${u.email}`, 'good'); }
          else { await api.post('/admin/users', { email: normaliseEmail(email.value), ...body }); toast(`Added ${normaliseEmail(email.value)}`, 'good'); }
        } catch (e) { serverError(summary, e); return false; }
        reload();
      } }] });
    return d;
  }
  async function deactivate(u) {
    const ok = await confirmDialog({ title: `Deactivate ${u.email}?`, text: 'They can no longer sign in and any open session stops working on its next request. You can reactivate them later; their history is kept.', ok: 'Deactivate', danger: true });
    if (!ok) return;
    try { await api.del(`/admin/users/${encodeURIComponent(u.email)}`); toast(`Deactivated ${u.email}`, 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad', 7000); }
  }
  async function reactivate(u) {
    try { await api.patch(`/admin/users/${encodeURIComponent(u.email)}`, { active: true }); toast(`Reactivated ${u.email}`, 'good'); reload(); } catch (e) { toast(errMsg(e), 'bad', 7000); }
  }

  /* ---- role matrix ---- */
  const perms = Object.keys(PERM_LABEL);
  root.append(h('div.card', { style: { marginTop: '24px' } }, h('div.card-h', h('h2', 'Role reference')),
    h('div.tbl-wrap', h('table.tbl.matrix', h('caption.sr', 'Permissions by role'), h('thead', h('tr', h('th', { scope: 'col' }, 'Permission'), ROLES.map((r) => h('th', { scope: 'col' }, r)))),
      h('tbody', perms.map((p) => h('tr', h('td', PERM_LABEL[p]), ROLES.map((r) => h('td', PERMISSIONS[r].includes(p) ? h('span.good', { 'aria-label': 'Allowed' }, '✓') : h('span.faint', { 'aria-label': 'Not allowed' }, '–'))))),
        h('tr', h('td', h('b', 'Scope')), ROLES.map((r) => h('td.sm', r === 'dcp' ? 'Region' : r === 'station' ? 'Station' : r === 'viewer' ? 'Read only' : 'City'))))))));
}
