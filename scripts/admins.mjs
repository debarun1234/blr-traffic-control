#!/usr/bin/env node
// List active admin users (used by scripts/doctor.sh). Usage: node scripts/admins.mjs --project ID
import { client } from './lib/firestore-rest.mjs';
const i = process.argv.indexOf('--project');
const project = i >= 0 ? process.argv[i + 1] : '';
if (!project) { console.error('usage: admins.mjs --project ID'); process.exit(2); }
try {
  const rows = await client(project).query('users', 'role', 'EQUAL', 'admin');
  const active = rows.filter((u) => u.active !== false);
  console.log(active.length ? active.map((u) => u.email).join(', ') : '(none)');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
