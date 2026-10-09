import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import * as L from '../src/lib/logic.mjs';
import { validateConnectorForm, CONNECTOR_TYPES } from '../src/lib/connector-types.mjs';
import { guideFor, ingestExamples } from '../src/lib/guides.mjs';

const MAP = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/mapdata/map.json'), 'utf8'));
const NAMES = MAP.st.map((s) => s.n);

test('parseCsv handles quotes, CRLF, BOM and blank lines', () => {
  assert.deepEqual(L.parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2'), [['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
  const { header, rows } = L.csvObjects('Name, Road\nA,B');
  assert.deepEqual(header, ['name', 'road']); assert.equal(rows[0].road, 'B');
});
test('toCsv quotes and round-trips', () => {
  const t = L.toCsv([{ a: 'x,y', b: 'q"r', c: null }], ['a', 'b', 'c']);
  assert.deepEqual(L.parseCsv(t), [['a', 'b', 'c'], ['x,y', 'q"r', '']]);
});
test('checkCsvHeader reports missing and unknown columns', () => {
  assert.match(L.checkCsvHeader('name,road\nx,y', 'works').join(' '), /Missing required columns: station, from, to/);
  assert.match(L.checkCsvHeader('station,year,fatal,nonfatal,extra\nA,2025,1,2', 'crash').join(' '), /Unknown column.*extra/);
  assert.match(L.checkCsvHeader('', 'works')[0], /empty/);
  assert.equal(L.checkCsvHeader(L.IMPORT_SPECS.works.example, 'works').length, 0);
});
test('projection round-trips and nearestNode finds the closest node', () => {
  const [x, y] = L.lonLatToXY(77.595, 12.975); assert.ok(Math.abs(x - 9750) < 1e-6 && Math.abs(y - 8750) < 1e-6);
  const [lo, la] = L.xyToLonLat(x, y); assert.ok(Math.abs(lo - 77.595) < 1e-9 && Math.abs(la - 12.975) < 1e-9);
  const hub = MAP.hubs[0]; const r = L.nearestNode(MAP.nxy, hub.x, hub.y); assert.ok(r.dist < 600);
  assert.ok(L.estimateFreeMin([0, 0], [10000, 0]) > 10);
});
test('validateSettings checks map views, speed bands and crash scale', () => {
  const base = { feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25 }, workflow: { escalateAfterMin: 15, verifyAfterMin: 30 }, caps: { routesCallsPerDay: 1, tomtomCallsPerDay: 1 } };
  const roles = (v) => Object.fromEntries(['admin', 'commissioner', 'dcp', 'station', 'viewer'].map((r) => [r, v]));
  const map = { defaultView: 'safety', views: { safety: roles(true), speed: roles(true) }, speedBands: { slow: 14, moderate: 20, good: 27, fast: 34 }, crashScale: 26 };
  assert.deepEqual(L.validateSettings({ ...base, map }), {});
  assert.ok(L.validateSettings({ ...base, map: { ...map, speedBands: { slow: 20, moderate: 20, good: 27, fast: 34 } } })['map.speedBands.moderate']);
  assert.ok(L.validateSettings({ ...base, map: { ...map, crashScale: 0 } })['map.crashScale']);
  assert.ok(L.validateSettings({ ...base, map: { ...map, defaultView: 'x' } })['map.defaultView']);
  assert.ok(L.validateSettings({ ...base, map: { ...map, views: { safety: roles(false), speed: roles(true) } } })['map.defaultView'], 'default view off for all roles');
});

test('validateSettings checks idle feed settings', () => {
  const ok = { feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25, idleAfterMin: 120, idleTickMin: 60 }, workflow: { escalateAfterMin: 15, verifyAfterMin: 30 }, caps: { routesCallsPerDay: 1, tomtomCallsPerDay: 1 } };
  assert.deepEqual(L.validateSettings(ok), {});
  assert.deepEqual(L.validateSettings({ ...ok, feed: { ...ok.feed, idleAfterMin: 0 } }), {}, '0 turns idle mode off');
  assert.ok(L.validateSettings({ ...ok, feed: { ...ok.feed, idleAfterMin: 2000 } })['feed.idleAfterMin']);
  assert.ok(L.validateSettings({ ...ok, feed: { ...ok.feed, idleTickMin: 5 } })['feed.idleTickMin']);
});

test('validateSettings enforces ranges and stale >= 2x tick', () => {
  const ok = { feed: { mode: 'blend', tickMin: 10, staleAfterMin: 25 }, workflow: { escalateAfterMin: 15, verifyAfterMin: 30 }, caps: { routesCallsPerDay: 100, tomtomCallsPerDay: 0 } };
  assert.deepEqual(L.validateSettings(ok), {});
  const e = L.validateSettings({ ...ok, feed: { mode: 'x', tickMin: 0, staleAfterMin: 5 } }); assert.ok(e['feed.mode'] && e['feed.tickMin']);
  assert.match(L.validateSettings({ ...ok, feed: { mode: 'sim', tickMin: 10, staleAfterMin: 15 } })['feed.staleAfterMin'], /twice|2x/);
  assert.ok(L.validateSettings({ ...ok, workflow: { escalateAfterMin: 1.5, verifyAfterMin: 30 } })['workflow.escalateAfterMin']);
});
test('validateAiLimits requires a model id for enabled tiers', () => {
  const ai = { dailyCallCap: 10, perUserDaily: { admin: 1, commissioner: 1, dcp: 1, station: 1, viewer: 0 }, tiers: { t1: { enabled: true, model: '' }, t2: { enabled: false, model: '' }, t3: { enabled: true, model: 'gemini-2.5-pro' } } };
  const e = L.validateAiLimits(ai); assert.ok(e['tiers.t1.model']); assert.ok(!e['tiers.t2.model']); assert.ok(!e['tiers.t3.model']);
});
test('validateSecretRef accepts names and rejects values', () => {
  assert.equal(L.validateSecretRef('routes-key', true), null); assert.equal(L.validateSecretRef('', false), null); assert.ok(L.validateSecretRef('', true));
  assert.match(L.validateSecretRef(''+'AIza'+'FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12'+''), /key value/); assert.ok(L.validateSecretRef('has space')); assert.ok(L.validateSecretRef('sk-live123'));
});
test('diffObjects lists only changed leaves', () => {
  const d = L.diffObjects({ a: { b: 1, c: 2 }, m: false }, { a: { b: 1, c: 3 }, m: true });
  assert.deepEqual(d.map((x) => [x.path, x.from, x.to]), [['a.c', 2, 3], ['m', false, true]]);
});
const sq = (x, y) => [[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]];
const feat = (station, ring) => ({ type: 'Feature', properties: { station }, geometry: { type: 'Polygon', coordinates: [ring] } });
test('validateGeoJSON accepts valid, flags missing stations as warning', () => {
  const r = L.validateGeoJSON({ type: 'FeatureCollection', features: [feat(NAMES[0], sq(77.6, 12.9))] }, NAMES);
  assert.deepEqual(r.errors, []); assert.equal(r.covered.length, 1); assert.equal(r.missing.length, 61); assert.equal(r.warnings.length, 1);
});
test('validateGeoJSON rejects bad input with specific messages', () => {
  const bad = (g) => L.validateGeoJSON(g, NAMES).errors.join('|');
  assert.match(bad(null), /JSON object/); assert.match(bad({ type: 'Feature' }), /FeatureCollection/);
  assert.match(bad({ type: 'FeatureCollection', features: [feat('Nowhere', sq(77.6, 12.9))] }), /not a known station/);
  const open = sq(77.6, 12.9).slice(0, 4); assert.match(bad({ type: 'FeatureCollection', features: [feat(NAMES[0], open)] }), /not closed/);
  assert.match(bad({ type: 'FeatureCollection', features: [feat(NAMES[0], sq(12.9, 77.6))] }), /outside Bengaluru/);
  assert.match(bad({ type: 'FeatureCollection', features: [feat(NAMES[0], sq(77.6, 12.9)), feat(NAMES[0], sq(77.62, 12.9))] }), /duplicate/);
  assert.match(bad({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { station: NAMES[0] }, geometry: { type: 'Point', coordinates: [77.6, 12.9] } }] }), /Polygon/);
  assert.match(bad({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [sq(77.6, 12.9)] } }] }), /properties.station is required/);
});
test('istDayStartMs is IST midnight', () => {
  const t = Date.parse('2026-10-07T20:00:00Z'); // 01:30 IST on 08 Oct
  assert.equal(new Date(L.istDayStartMs(t) + L.IST_MS).toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(L.dateInputToMs('2026-10-07'), Date.parse('2026-10-06T18:30:00Z'));
});
test('connector validation: rest', () => {
  const good = { name: 'ASTraM', intervalMin: 5, config: { target: 'events', url: 'https://x.example.gov.in/v1', method: 'GET', headerNames: ['Authorization'], mapping: { externalId: 'id', type: 'kind', durationMin: 'mins', lat: 'a', lon: 'b' } } };
  assert.deepEqual(validateConnectorForm('rest', good), {});
  assert.ok(validateConnectorForm('rest', { ...good, config: { ...good.config, url: 'http://insecure.example' } }).url);
  assert.match(validateConnectorForm('rest', { ...good, config: { ...good.config, url: 'https://x.example/api?key=abc' } }).url, /Keys must not/);
  assert.match(validateConnectorForm('rest', { ...good, config: { ...good.config, mapping: { externalId: 'id' } } }).mapping, /Map required fields/);
  assert.match(validateConnectorForm('rest', { ...good, config: { ...good.config, mapping: { externalId: 'id', type: 't', durationMin: 'd' } } }).mapping, /edge or both lat and lon/);
  assert.ok(validateConnectorForm('rest', { ...good, config: { ...good.config, headerNames: ['bad header!'] } }).headerNames);
  assert.ok(validateConnectorForm('rest', { ...good, name: 'x' }).name);
});
test('connector validation: paid connectors need cap and probes', () => {
  const e = validateConnectorForm('google_routes', { name: 'GRoutes', intervalMin: 10, config: { probeIds: [] } }, ['p1']);
  assert.ok(e.dailyCap && e.probeIds);
  assert.deepEqual(validateConnectorForm('google_routes', { name: 'GRoutes', intervalMin: 10, dailyCap: 400, config: { probeIds: ['p1'] } }, ['p1']), {});
  assert.ok(validateConnectorForm('tomtom', { name: 'TomTom', intervalMin: 10, dailyCap: 5, config: { probeIds: ['zzz'] } }, ['p1']).probeIds);
  assert.deepEqual(validateConnectorForm('sim', { name: 'Sim', intervalMin: 10, config: {} }), {});
});
test('every connector type has label, blurb, needs and a guide', () => {
  for (const [k, T] of Object.entries(CONNECTOR_TYPES)) { assert.ok(T.label && T.blurb && T.needs.length, k); assert.ok(guideFor(k, 'https://x').length, k); }
  const g = JSON.stringify(guideFor('webhook', 'https://api.example.gov.in')); assert.ok(g.includes('$BLR_API_KEY') && g.includes('/ingest/v1/events'));
  assert.ok(!/blr_[0-9a-f]{16}/.test(JSON.stringify(ingestExamples('https://x'))), 'guides contain only placeholder keys');
});
