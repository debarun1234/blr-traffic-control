# Integration guide: connecting existing systems

All connectors are managed in the Admin site (Connectors). Secrets never pass through the API: store them with `scripts/set-secret.sh --env <env> --id <connector-id>` (Secret Manager `blr-connector-<id>`), then set the connector's `secretRef`. Every connector has `intervalMin`, an optional `dailyCap` (mandatory for paid ones), and a `shadow` mode that runs and records but does not change state.

| Type | Use | Notes |
|---|---|---|
| `sim` | Built-in modelled traffic | Always available, fallback |
| `rest` | Poll an HTTPS JSON API (ASTraM, ANPR, BATCS exports) | JSON path to the records array and a field mapping; header names in config, values from the secret (JSON object keyed by header name). No keys in URLs |
| `webhook` | External system pushes to `/ingest/v1/*` | Needs an API key with matching scope |
| `csv` | CSV by URL or manual upload | Works or crash records; column spec shown in the Admin site |
| `google_routes`, `tomtom` | Corridor travel times for calibration | Paid per call: set `dailyCap`; each selected probe costs one call per run. Verify current pricing yourself |
| `gba_works` | GBA or BMRCL works export (CSV, JSON, GeoJSON) | Stamped with agency name, kept in sync |
| `opencity_crash` | BTP crash CSV from OpenCity | Columns: station, year, fatal, nonfatal |

## Inbound push (`x-api-key`)

Create a key under API keys (shown once, stored as SHA-256, scoped, rate-limited).

- `POST /ingest/v1/events` `{events:[{externalId,type,edge | lat+lon,startHour?,durationMin,cap?}]}`, idempotent on `externalId`
- `POST /ingest/v1/speeds` `{observations:[{probeId,minutes,at?}]}`
- `POST /ingest/v1/works` `{works:[...]}`

Lat/lon snap to the nearest routable road within 150 m, otherwise that row is rejected.

## Rules

1. Outbound URLs must be HTTPS; private and metadata addresses are blocked (SSRF guard); responses are size-capped; a circuit breaker pauses a failing connector.
2. **Never map vehicle plate numbers, names or phone numbers.** Only road segment, type and time are stored.
3. Start every new connector in `shadow` mode, compare, then switch to `live`.
4. Check System checks in the Admin site after enabling anything.

The authoritative payload shapes are in [api-contract.md](api-contract.md).

## Google Maps basemap and Google Routes

Two separate Google keys, two separate jobs:

| Key | Used by | Where it lives | Restrict to |
|---|---|---|---|
| Maps JavaScript API key | Optional Google basemap in the Control app (Layers → Basemap) | `maps_browser_key` in your git-ignored `dev.tfvars` → Terraform output → `config.js`. Public by design | HTTP referrers: the two `*.web.app` / `*.firebaseapp.com` Control domains; API: Maps JavaScript API only |
| Routes API key | `google_routes` connector (Admin → Connectors) | Secret Manager via `scripts/set-secret.sh`; the connector holds only `secretRef` | API: Routes API only; no referrer restriction (server-side calls) |

Enable billing on the project. Terraform enables `maps-backend` and `routes`; deploy with the full Deploy workflow after setting `maps_browser_key` (optionally `maps_map_id`, a vector map ID, for smooth zoom; otherwise Google's demo ID is used).

Behaviour: the basemap is a layer under the existing canvas; the model's roads, incidents and stations stay ours and Google's logo/attribution stay visible. Plain (built-in) remains the default, so Maps is only loaded, and billed, when someone selects it. If Google rejects the key the app falls back to Plain and says so.

Terms caveat: Routes API durations are used only to calibrate the model; the app does not draw Google traffic or route geometry on a non-Google map. Have your counsel confirm that calibration use fits the Maps Platform terms before relying on it operationally.

## Bengaluru Rural coverage (not yet built)

The road graph, station territories and city boundary come from the offline pipeline in `tools/mapdata` (OpenStreetMap roads plus the police station list). Extending to Bengaluru Rural means re-running that pipeline over the larger area with Rural stations and boundary added as a separate zone, then regenerating `packages/mapdata/map.json`. Confirm first that the Commissionerate's jurisdiction includes the Rural stations; as far as I know Rural has its own district police.
