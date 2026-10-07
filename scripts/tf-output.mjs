#!/usr/bin/env node
// Print selected values from `terraform output -json` as key=value lines (GitHub Actions $GITHUB_OUTPUT format).
// Usage: node scripts/tf-output.mjs <outputs.json> repo=artifact_repository api=api_service ...
import { readFileSync } from 'node:fs';
const [file, ...pairs] = process.argv.slice(2);
if (!file || pairs.length === 0) { console.error('usage: tf-output.mjs <outputs.json> alias=output_name ...'); process.exit(2); }
const o = JSON.parse(readFileSync(file, 'utf8'));
for (const p of pairs) {
  const [alias, name] = p.split('=');
  const v = o[name]?.value;
  console.log(`${alias}=${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`);
}
