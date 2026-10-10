# API contract (v1)

Single source of truth for `apps/api`, `apps/worker`, `apps/control`, `apps/admin`. All bodies are JSON (UTF-8). All times are
epoch milliseconds unless a field says `hour` (IST hour-of-day float, 0–24). Base path `/api`. Errors: HTTP status +
`{"error":{"code":"forbidden","message":"..."}}`. Codes: `unauthenticated`(401) `forbidden`(403) `not_found`(404) `invalid`(400) `conflict`(409) `rate_limited`(429) `quota_exceeded`(429) `unavailable`(503).

## Authentication
* Browser: Google sign-in through Identity Platform (Firebase Auth JS SDK) → `Authorization: Bearer <Firebase ID token>`.
* The API verifies the token (`firebase-admin`), lowercases the email, loads `users/{email}`. **No user doc or `active:false` → 403 `forbidden`** (sign-in is allowlist-only). First successful call stores `uid` and `lastLogin`.
* Bootstrap: env `BOOTSTRAP_ADMIN_EMAILS` (comma list) are treated as role `admin` even with no doc, and a doc is created on first login.
* Dev/test only: `AUTH_MODE=dev` accepts header `x-dev-user: <email>` and loads the same `users/{email}` doc. The server **must refuse to start** with `AUTH_MODE=dev` when `NODE_ENV=production`.
* Server-to-server inbound (external systems): header `x-api-key: <key>` on `/ingest/v1/*` only. Keys are stored as SHA-256 hashes, scoped (`events`,`speeds`,`works`), rate-limited.
* Internal (Scheduler / Pub/Sub → worker): `/internal/*` requires a Google OIDC token whose email equals `INTERNAL_INVOKER_SA`.

## Data model (Firestore collections; same shapes in the in-memory store used by tests)
| collection / doc | shape |
|---|---|
| `users/{email}` | `{email,name?,role:'admin'|'commissioner'|'dcp'|'station'|'viewer',region?,station?,active:boolean,uid?,createdBy,createdAt,lastLogin?}` |
| `state/current` | see **State** below (one doc, overwritten each tick). `state/meta` holds the last tick (`lastTickAt`, `idle`, …); `state/activity` `{lastSeenAt}` is written by `/me` and `/state` at most every 2 min per instance |
| `state_hist/{yyyyMMddHHmm}` | `{t,mode,summary,expireAt}` (TTL 72 h; no per-edge arrays) |
| `actions/{id}` | `{id,incidentId,type:'cong'|'inc'|'work',edge,station,region,title,detail,pri:'hi'|'md',state,raisedAt,raisedHour,ackAt?,ackBy?,progAt?,doneAt?,doneBy?,verifiedAt?,vc0?,vc1?,escalated:boolean,escalatedAt?,date}` — `id` = `A-{incidentId}` |
| `incidents/{id}` | `{id,src:'sim'|'user'|'connector'|'ingest',type,edge,station,date,startHour,endHour,cap,by?,connectorId?,createdAt}` |
| `works/{id}` | `{id,name,road,stations:[name],from:'YYYY-MM-DD',to,hours:'all'|'peak'|'night',cap:0..1,kind,agency?,source:'manual'|'csv'|'connector'|'ingest',active:boolean,by,createdAt}` |
| `crash_stats/{station}` | `{station,y2025:{fatal,nonfatal},hist:{'2018':[fatal,nonfatal],...},source,importedAt}` (seeded from `packages/mapdata/crash.json`) |
| `stations/{name}` | admin overrides `{name,lat?,lon?,aliases?,notes?,verified:boolean}` |
| `territories/current` | `{geojson,uploadedBy,uploadedAt,source}` (optional official boundaries; absent → built-in approximate) |
| `connectors/{id}` | `{id,type:'sim'|'rest'|'webhook'|'csv'|'google_routes'|'tomtom'|'gba_works'|'opencity_crash',name,enabled,intervalMin,config:{…non-secret…},secretRef?,dailyCap?,mode:'live'|'shadow',createdBy,createdAt,lastRun?:{at,ok,ms,count,error?}}` |
| `connector_runs/{id}` | `{connectorId,at,ok,ms,count,error?,cost?:{calls}}` (TTL 14 d) |
| `probes/{id}` | `{id,name,fromNode,toNode,fromLabel,toLabel,freeMin,enabled,weight}` — node ids index `map.json` route nodes |
| `probe_obs/{id}` | `{probeId,at,minutes,source}` (TTL 7 d) |
| `apikeys/{id}` | `{id,name,hash,prefix,scopes:[…],rateLimit,createdBy,createdAt,lastUsed?,revoked:boolean}` |
| `settings/app` | `{feed:{mode:'sim'|'live'|'blend',tickMin:10,staleAfterMin:25,idleAfterMin:120,idleTickMin:60},workflow:{escalateAfterMin:15,verifyAfterMin:30},ai:{enabled,dailyCallCap,perUserDaily:{admin,commissioner,dcp,station,viewer},tiers:{t1:{enabled,model},t2:{…},t3:{…}},killReason?},caps:{routesCallsPerDay,tomtomCallsPerDay},map:{defaultView:'traffic'|'safety'|'speed',views:{safety:{[role]:boolean},speed:{[role]:boolean}},layers:{minorRoads,stations,incidents,works,googleTraffic:boolean},speedBands:{slow,moderate,good,fast:int km/h, strictly rising},crashScale:int},maintenance:boolean}` (`map.views` and `map.layers` are admin-controlled; Live traffic is always available) |
| `ai_usage/{yyyyMMdd}` | `{date,calls,tokensIn,tokensOut,byTier:{t0,t1,t2,t3},byUser:{email:calls},cacheHits,estCostUsd}` |
| `ai_cache/{sha256}` | `{key,tier,text,createdAt,expireAt}` (TTL 24 h) |
| `audit/{id}` | `{id,at,actor,role,kind,target,summary,ip?,meta?}` (append-only; never updated or deleted by the app) |
| `checks/latest` | `{at,results:[{id,name,status:'ok'|'warn'|'fail',detail,ms}]}` |

## State (`GET /api/state`)
Response header `ETag`; request `If-None-Match` → `304`. Response (`state/current` plus server fields):
```json
{ "t": 1791378144000, "hour": 18.33, "date": "2026-10-07", "mode": "sim|live|blend", "boost": 1.12, "stale": false,
  "updatedAt": 1791378140000, "net": {"edges": 15051, "mapVersion": "…"},
  "city": {"speed": 31.2, "congPct": 12.4},
  "stations": [{"i":0,"speed":28.1,"cong":14.0}],
  "vc": "<base64 uint8 per edge, vc*100>", "spd": "<base64 uint8 per edge, km/h>",
  "incidents": [{"id":"…","type":"…","edge":123,"station":4,"startHour":8.1,"endHour":9.0,"cap":0.5,"src":"sim"}],
  "works": [{"id":"…","name":"…","road":"…","stations":["…"],"cap":0.7}],
  "calibration": {"rmsePct": 9.1, "probes": 14, "at": 1791378000000} }
```
Edges are indexed exactly as `packages/mapdata/map.json` `r[]`; `@blr/model` `decodeState` decodes `vc`/`spd`.
Everything in `/state` is **modelled**; `mode:"live"` means the model is calibrated against probe observations, not that every edge is measured. The UI must say so.

## Endpoints (caller role in brackets; `*` = any signed-in allowlisted user)

### Session
* `GET /api/me` `*` → `{email,name,role,region,station,active,permissions:string[],lockedRegion:string|null,jurisdiction:string[],flags:{aiEnabled:boolean,maintenance:boolean},map:{…as settings.map…}}`. `map` carries the admin-controlled view and layer settings; the Control app re-reads `/me` about every 4 ticks and hides views and layers that are switched off for the caller's role.
* `POST /api/preflight` `*` → `{at,day,api:{ok,ms},data:{ok,mode,ageMin,stale,limitMin},ai:{status,detail,cached},glance:{incidents,actions,works,stations,mode},maintenance,platform?}` for the sign-in welcome screen (`platform` only for `admin`: system checks, users, connectors, AI usage). The AI probe runs at most once per IST day for the whole system (see the runbook).
* `GET /healthz` (public, no auth) `{ok:true}`; `GET /readyz` (public) checks store reachability → `{ok,store:'ok'}`.

### Operations
* `GET /api/state` `*` → State.
* `POST /api/refresh` `state.refresh` (admin, commissioner) → `{ok, updatedAt, tickMs}`. Runs one tick now in the API process. Connectors still follow their own intervals and daily caps, so it never makes an extra paid call. One refresh a minute for the whole city (`429 rate_limited` with `retry-after`), one at a time (`409 conflict`). Audited as `feed_refresh`. The Control app shows a Refresh now button to users who have the permission.
* `GET /api/crash` `*` → `{stations:{[name]:{y2025:{fatal,nonfatal},hist}},importedAt}`. Only the 53 police stations have entries; the 9 outer taluk units have none and the UI shows a dash.
* `GET /api/actions?state=open|all&limit=200` `*` → `{actions:[…]}` filtered server-side: `station`/`dcp` get their **region**; others all. Sorted escalated first, then newest.
* `POST /api/actions/:id/transition` `{to:'ack'|'prog'|'done', note?}` → updated action. Requires `action.transition` **and** the action's station ∈ caller jurisdiction, else 403. Illegal transition → 409. Writes audit.
* `GET /api/incidents?date=` `*` → `{incidents:[…]}` (sim + user + connector for the date).
* `POST /api/incidents` `{edge:number,type:string,durationMin:10..240,note?}` `incident.report` & station of `edge` ∈ jurisdiction → incident (src `user`) and a new action. Audit.
* `POST /api/incidents/:id/extend` `{minutes:10..240}`, `/confirm`, `/clear` (no body): `incident.report` & the incident's station ∈ jurisdiction. Stored incidents only (simulated ones return 409). `clear` sets the end to now and marks the linked action done; `extend` is capped at 12 h from the start; a cleared incident returns 409. Audit `incident_extend`, `incident_confirm`, `incident_clear`.
* `GET /api/works` `*` → `{works:[…]}`; `POST /api/works` / `PATCH /api/works/:id` / `DELETE /api/works/:id` require `works.write`; `DELETE` is a soft delete (`active:false`). Audit.
* `POST /api/ai/advise` `ai.advise` `{kind:'action_advice'|'translate_kn'|'works_clash',context:object}` → `{text,tier:'t0'|'t1'|'t2',cached:boolean,model?}`
* `POST /api/ai/brief` `ai.brief` `{scope:'city'|'Urban'|region}` → `{text,tier:'t3',cached,generatedAt}` (cached per scope+hour; at most `brief` quota/day).
* `GET /api/ai/quota` `*` → `{used,limit,resetsAt,aiEnabled}`.

### Admin (role `admin` only; every mutation writes an audit row)
* Users: `GET /api/admin/users`, `POST /api/admin/users` `{email,name?,role,region?,station?}`, `PATCH /api/admin/users/:email` `{role?,region?,station?,active?}`, `DELETE /api/admin/users/:email` (soft: `active:false`). An admin cannot demote or disable themselves, and the last active admin cannot be removed.
* Stations: `GET /api/admin/stations` (map stations + overrides + crash import status), `PATCH /api/admin/stations/:name` `{lat,lon,aliases,notes,verified}`.
* Territories: `GET /api/admin/territories`, `PUT /api/admin/territories` `{geojson}` (FeatureCollection of Polygons with `properties.station`; validated), `DELETE` reverts to built-in.
* Connectors: `GET/POST /api/admin/connectors`, `PATCH/DELETE /api/admin/connectors/:id`, `POST …/:id/test` (dry run, never writes state; returns `{ok,sample,ms,error?}`), `POST …/:id/run` (run now), `GET …/:id/runs?limit=`. `secretRef` names a Secret Manager secret; **secret values never pass through or are returned by the API**.
* Probes: `GET/POST/PATCH/DELETE /api/admin/probes`, `GET /api/admin/probes/observations?probeId=&limit=`.
* Settings: `GET/PUT /api/admin/settings` (validated; unknown keys rejected).
* Checks: `GET /api/admin/checks` (latest), `POST /api/admin/checks/run` (run all now).
* AI & cost: `GET /api/admin/ai/usage?days=14`, `PUT /api/admin/ai/limits`, `POST /api/admin/ai/kill` `{enabled:boolean,reason}`.
* Audit: `GET /api/admin/audit?actor=&kind=&from=&to=&limit=&before=`, `GET /api/admin/audit.csv?…`.
* API keys: `GET/POST/DELETE /api/admin/apikeys` (`POST` returns the plaintext key once).
* Imports: `POST /api/admin/import/crash` (`text/csv` body: `station,year,fatal,nonfatal`), `POST /api/admin/import/works` (`text/csv`: `name,road,station,from,to,hours,cap,kind,agency`). Both return `{accepted,rejected:[{row,reason}]}` and support `?dryRun=1`.
* Data exports: `GET /api/admin/export/actions.csv?from=&to=`.

### Inbound (external systems) — `x-api-key`
* `POST /ingest/v1/events` `{events:[{externalId,type,edge?|lat+lon?,startHour?,durationMin,cap?}]}` (idempotent on `externalId`)
* `POST /ingest/v1/speeds` `{observations:[{probeId,minutes,at?}]}`
* `POST /ingest/v1/works` `{works:[…works shape…]}`
Lat/lon snap to the nearest routable edge within 150 m, else reject that row.

### Worker (private, OIDC)
* `POST /internal/tick` – feed tick: run enabled connectors due → build capacity multipliers (incidents + active works) → calibrate vs probes → `assign` → write `state/current` + `state_hist` → generate/escalate/verify actions.
* `POST /internal/checks` – run system checks, write `checks/latest`.
* `POST /internal/budget` – Pub/Sub push from the billing budget: when `costAmount/budgetAmount ≥ 1.0` set `settings/app.ai.enabled=false` and disable paid connectors (`google_routes`,`tomtom`), audit `kind:'budget_kill'`.
* `POST /internal/retention` – delete expired docs.

## Roles (see `packages/shared`)
`admin`: all + admin site. `commissioner`: whole city, may write works, may request the city brief. `dcp`: one region, acts on stations in region. `station`: one station; sees its **region** map; acts only on its own station. `viewer`: read-only. Station users see city-wide *state* (so the map is continuous) but the UI dims everything outside their region and the API refuses writes outside jurisdiction.

## AI routing & cost (see docs/cost-and-ai.md)
Tier **t0** = deterministic templates (no model), used only as the fallback for action advice; the response then has `fallback: 'error'|'timeout'|'quota'`. A brief or advice answer that the model had to cut short is trimmed to the last full sentence, flagged `truncated: true` and not cached. Output budgets have floors (t1 300, t2 800, t3 1,500 tokens) because Gemini thinking tokens share them. **t1** = cheapest Gemini (translation, short summaries). **t2** = mid Gemini (action advice, works-clash narrative). **t3** = strongest Gemini (commissioner brief only, ≤ N/day, cached per hour). Every call: check kill-switch → per-user quota → global daily cap → cache lookup → call → record usage. Model ids come from `settings/app.ai.tiers.*.model` / env, never hard-coded in logic.

## Static assets (served by Firebase Hosting, not the API)
`/assets/map.json` (from `packages/mapdata`), `/vendor/model.mjs`, `/vendor/shared.mjs`, `/vendor/ui.css`, `/vendor/ui.mjs`.
