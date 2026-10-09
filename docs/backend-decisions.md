# Backend decisions (packages/core, apps/api, apps/worker)

Where `docs/api-contract.md` was ambiguous or silent, the simplest reading was taken. One bullet per decision.

## Contract readings
- `/healthz` and `/readyz` are served at the root and also at `/api/healthz`, `/api/readyz` (Hosting only rewrites `/api/**`). Both are unauthenticated and not rate limited.
- Stored `station` fields (incidents, actions, works) are station **names**; `state.incidents[].station` is the station **index** as in the contract.
- `cap` (incidents, works) is the **remaining capacity multiplier** (0.4 = 40% left), matching `INCIDENT_TYPES`. The engine clamps it to a minimum of 0.05 so one incident cannot disconnect the graph.
- Incident caps for user and ingested incidents come from `INCIDENT_TYPES` by type name, default 0.5.
- "Illustrative seed" works are those with `source:'seed'` or `illustrative:true`. They are never applied to capacity and never raise actions.
- `POST /api/incidents` returns **201** `{incident, action}`. `POST /api/works` returns 201 with the work.
- `GET /api/works` returns active works only; `?includeInactive=1` includes soft-deleted ones.
- Import responses: `accepted` is a **count** (number); `rejected` is `[{row,reason}]` where `row` is the 1-based CSV line including the header (first data row = 2). Ingest responses use `{accepted, created, updated, rejected:[{index,reason}]}`.
- `POST /api/admin/ai/kill {enabled,reason}` sets `ai.enabled = enabled` (`enabled:false` is the kill). `reason` is required (3..300 chars) when disabling and is stored in `ai.killReason`.
- Self-demotion, self-disable and removing the last active admin return **409 conflict**. Creating an existing user returns 409 (use PATCH to re-activate).
- `PUT /api/admin/ai/limits` accepts only `dailyCallCap, briefPerDay, perUserDaily, tiers, maxOutputTokens, timeoutMs, prices` and merges them into `settings/app.ai`.
- Connector `DELETE` is a hard delete (runs stay until their TTL). New connectors default to `enabled:false`.
- `/api/ai/advise` with `context.actionId` ignores client numbers and builds the context from stored state and the road graph. Action advice always goes to tier t2 when AI is on; the t0 template is only the fallback (AI off, tier off, model error or timeout, or the caller's or the system's daily quota used up), and the response then carries `fallback` (`error`, `timeout` or `quota`).
- `/api/ai/quota.used` counts the caller's model calls today (t0 templates and cache hits are free). With no AI router configured it returns `aiEnabled:false`.

## Additive fields and collections (not in the contract)
- Settings: `ai.briefPerDay`, `ai.maxOutputTokens{t1..t3}`, `ai.timeoutMs{t1..t3}`, `ai.prices{t1..t3:{inPerM,outPerM}}`. Defaults for tier model ids come from env `AI_MODEL_T1..T3`; they are never named in logic. Prices are estimates and labelled so in usage docs (`costNote`).
- Connector docs: `failures`, `disabledReason`; `connector_runs.shadow`. Action docs: `vc0` is set at raise time, `vc1`, `verifiedAt` at verification.
- `state/meta` `{tickMs,lastTickAt,mode,...}` (used by the checks); `counters/{name}-{yyyyMMdd}` `{calls,expireAt}` for per-day API-call caps (`routes`, `tomtom`, `conn-{connectorId}`).
- `state_hist` docs also carry `id` (`yyyyMMddHHmm` in IST) and `summary.{speed,congPct,incidents,works,boost}`.
- Incident ids: user `u-{ts36}-{rand}`, ingest `ing-{keyId}-{externalId}`, connector `c-{connectorId}-{externalId}`. Works ids: `w-...` (manual), `w-csv-{hash}`, `w-ing-{hash}`, `w-c-{connector}-{hash}`; hashes make re-imports update instead of duplicating.

## State engine
- Sim incidents (`@blr/model simIncidents`) are used when `feed.mode` is `sim` or `blend`; stored incidents of today and yesterday are always used (yesterday's cover past-midnight durations). Mode `live` ignores sim incidents.
- Calibration runs for `live`/`blend`: latest observation per enabled probe within `staleAfterMin`; fewer than 3 fresh -> skipped, `calibration:{skipped:true,reason,probes,rmsePct:null,at}`, `boost=1`, `stale=true`. Probe `weight` is not used by `@blr/model calibrate` and is ignored. Boost is bounded 0.5..2 (also passed as `lo`/`hi` to the bisection).
- `GET /api/state` also sets `stale:true` when `now - updatedAt > staleAfterMin`, so a dead scheduler is visible; ETag derives from `updatedAt|stale|mode`.
- Congestion actions: worst edge per (road, station) with `vc>=1.0`, named roads of class 0/1 only, top 20 per tick, skipped while an open cong action for the same road+station exists that day. Work-start actions: one per active work with `from == today` (first listed station).
- Verification: `cong` -> persist iff `vc1>=0.9`; `inc`/`work` -> persist iff the incident/work is still active, else cleared. Escalation and verification write `audit` rows with actor `system`.
- Action creation uses create-if-absent (`store.update(col,id,fn)`), so concurrent or repeated ticks never reset an acknowledged action.

## Store
- Extra interface semantics: `update(col,id,fn)` is an atomic read-modify-write (fn gets `null` when missing; return `undefined` to leave unchanged) and is used for counters, usage and create-if-absent. `update(col,id,patch)` is a shallow top-level merge and throws `not_found`.
- Firestore `update`/`batch` use transactions (read, merge, set) to keep shallow-merge semantics identical to memory. `expireAt` is written as a Timestamp so the Firestore TTL policy works, and read back as epoch ms.
- Queries that need **composite indexes** in Firestore: `actions (region ASC, raisedAt DESC)`, `audit (actor ASC, at DESC)`, `audit (kind ASC, at DESC)`, `connector_runs (connectorId ASC, at DESC)`, `probe_obs (probeId ASC, at DESC)`, `users (role ASC, active ASC)`. TTL policies on `expireAt`: `state_hist`, `probe_obs`, `ai_cache`, `connector_runs`, `counters`. `/internal/retention` also deletes expired docs of those collections (never `audit`).

## Security
- Auth: Firebase tokens must have `email_verified`. A user doc always wins over `BOOTSTRAP_ADMIN_EMAILS` (the bootstrap list only supplies a doc when none exists). `uid`/`lastLogin` are written on first login and refreshed at most every 10 minutes. The user cache is 60 s and cleared on admin edits made through this process; other instances see changes within 60 s.
- Rate limits (per IP for `/api` 600/min, `/ingest` 300/min; AI 20/min/user; per API key from the key doc) are in-memory per instance, i.e. approximate on Cloud Run with several instances.
- Connector SSRF guard: https only when `NODE_ENV=production` (http allowed otherwise), no credentials in URL, no redirects, blocks private/loopback/link-local/CGNAT/multicast/metadata ranges after DNS resolution (all A/AAAA records). Residual risk: `fetch` re-resolves DNS, so a rebinding attack between check and connect is not excluded; an egress firewall (VPC) is the real control.
- Config keys that look like secrets (`secret|password|token|apikey|authorization|...`) and auth headers are rejected in connector config; only `secretRef` (a Secret Manager name) is stored. Error text is scrubbed of the secret value and `key=` query params.
- `dailyCap` on a connector counts outbound HTTP calls per IST day (one per run for rest/csv types, one per probe for google_routes/tomtom). `google_routes`/`tomtom` also consume the global `caps.*CallsPerDay`. `test` on those types spends real calls (limited to one probe).
- Connector `mode:'shadow'` runs and records `connector_runs` but writes no incidents, observations, works or crash data.

## Worker
- `/internal/*` requires an OIDC token whose email equals `INTERNAL_INVOKER_SA` (unset -> deny all). Audience check uses `INTERNAL_AUDIENCE` when set.
- `/internal/tick` has an in-process re-entrancy guard only; the tick is idempotent, so overlapping instances are safe but wasteful. Malformed budget notifications get 400.
- Env summary: `PORT`, `NODE_ENV`, `AUTH_MODE` (dev only), `BOOTSTRAP_ADMIN_EMAILS`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE`, `VERTEX_LOCATION` (default `global`), `AI_MODEL_T1..T3`, `INTERNAL_INVOKER_SA`, `INTERNAL_AUDIENCE`, `LOG_LEVEL`.

## Build
- Docker: build from the repo root (`docker build -f apps/api/Dockerfile .`). Ignore rules are in `apps/*/Dockerfile.dockerignore` (BuildKit per-Dockerfile ignore) because the root `.dockerignore` is outside this task's ownership. Image build was not run here (no Docker daemon); the `npm ci -w` subset install and the runtime file layout were verified by hand.
- `apps/api/src/dev.mjs` uses a labelled stub for AI when `GOOGLE_CLOUD_PROJECT` is unset.
