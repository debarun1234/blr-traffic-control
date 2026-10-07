// Node-side loader for the packaged map. The browser fetches /assets/map.json directly.
import { readFileSync } from 'node:fs';
const url = new URL('./map.json', import.meta.url);
let cache;
export function loadMap() { return (cache ??= JSON.parse(readFileSync(url, 'utf8'))); }
