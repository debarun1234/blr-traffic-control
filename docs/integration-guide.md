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

## Bengaluru Rural coverage

Rural is covered by Google's own live traffic, not by our model. With a Google basemap selected, Layers → "Google live traffic" draws Google's Traffic layer over the whole visible area (zoom out beyond the city). It is Google's data on Google's map, which keeps within the Maps terms. Rural has no modelled congestion, actions, station territories or crash statistics because the road graph and stations come from the offline pipeline in `tools/mapdata` (OpenStreetMap roads plus the BTP station list), and Google data cannot be bulk-extracted into that graph under its terms.

Extending the modelled network to Rural means re-running that pipeline with OpenStreetMap road extracts and a Rural station list added as a separate zone. Confirm first that the Commissionerate's jurisdiction includes Rural stations; as far as I know Rural has its own district police.

## Map views and layers (admin-controlled)

The Control map's **Map** panel offers three views, each with an on-screen legend and a "use it to" line:

| View | Colours | Source | Use it to |
|---|---|---|---|
| Live traffic | Roads by modelled load ÷ capacity | Simulator, calibrated by probes | Spot building congestion, place units |
| Crash hotspots | Station areas by 2025 fatal crashes | BTP crash dataset (`tools/mapdata`) | Focus enforcement, patrols, signage. Outer taluks have no records (grey) |
| Area speed | Station areas by average modelled speed | Same model as Live traffic | Compare areas, prioritise signal retiming |

Admin → Settings → "Map views and layers" controls, for everyone and without a deploy: the default view; which roles may open Crash hotspots and Area speed (Live traffic is always on); data layers (Local roads, Police stations, Incidents, Road works, Google live traffic); the five speed-colour boundaries (km/h, strictly rising); and the crash count that gives the darkest shade. Settings live in `settings.map` and reach the Control app through `GET /api/me` (re-read every ~4 ticks). A view or layer switched off is hidden from the panel, the legend and the map; a user's saved choice falls back to the default if it is no longer allowed.
