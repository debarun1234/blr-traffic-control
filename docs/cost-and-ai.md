# Cost and AI controls

**Every price in this page is an assumption. Verify against the current Google Cloud pricing pages (Cloud Run, Firestore, Vertex AI, Firebase Hosting, Cloud Scheduler, Maps Platform Routes) and your billing account currency before relying on any number. Free-tier quantities are quoted from memory of the published tiers and must be re-checked too.**

Design rule: the bill is bounded by caps that exist in configuration, not by good behaviour. Each cost driver below names its control, and the last line of defence (the billing budget kill switch) turns off the two things that can spend money without a human.

## Cost drivers and controls

| Driver | What makes it grow | Control | Where |
|---|---|---|---|
| Cloud Run API | Requests and CPU-seconds | Scale to zero, request-based CPU, concurrency 80, `max_instance_count` 3 (hard ceiling), 1 vCPU / 512 MiB | `api_min_instances`, `api_max_instances`, `api_cpu`, `api_memory` |
| Cloud Run worker | Ticks and checks | Max 1 instance; about 6.2k invocations a month by construction | `scheduler` module |
| **Firestore reads** | Each client poll reads `state/current` plus the actions query, which **today reads up to 1,000 documents** | A time-window query and a short server-side cache (below); `ETag` / `304` for state; TTL on history | API; **see the warning below** |
| Firestore storage and writes | History, audit | TTL on `state_hist` (72 h), `probe_obs`, `connector_runs`, `ai_cache`, `counters`; no per-edge arrays in history | `firestore` module |
| Firebase Hosting | Page loads (map.json is about 1.0 MB, about 340 KB gzipped) | CDN, `ETag` revalidation hourly on `/assets` and `/vendor`, no images or tiles | `firebase.json` |
| Cloud Scheduler | Number of jobs | 6 jobs total | `tick_schedules` variable |
| Gemini (Vertex AI) | Calls and tokens | Tiering t0 to t3, per-role daily quota, global daily cap, hourly brief cache, 24 h answer cache, max output tokens, timeouts, kill switch | `settings/app.ai`, admin site |
| Routes API / TomTom | Probes x runs per day | Per-connector `dailyCap`, global `caps.routesCallsPerDay` / `caps.tomtomCallsPerDay` (atomic counter), `intervalMin`, shadow mode, secret only present when enabled | `settings/app.caps`, connectors |
| Logging and monitoring | Request volume | Log-based metrics only (no custom metrics), 1 uptime check every 5 min | `monitoring` module |
| Artifact Registry, GCS | Image and export storage | Keep 10 versions, 30 day bucket lifecycle | `registry`, `storage` modules |
| Anything else | A bug or abuse | **Billing budget with Pub/Sub kill switch** | `budget` module |

### Warning: Firestore reads dominate, and as implemented they are the largest cost by far

The control app polls every 30 s while the tab is visible and calls `/api/state` and `/api/actions?state=all&limit=200`. In `apps/api/src/routes/ops.mjs` the `state=all` branch runs `store.list('actions', {orderBy raisedAt desc, limit: 1000})` and only afterwards slices to the requested 200. Every document read is billed, `actions` has no TTL, so after a few weeks every poll reads 1,000 documents (plus 1 for state). Cost scales with users x hours open, not with how often data changes (the state changes every 10 minutes).

Fix in the API (not an infra change; flagged for the API owner):

1. Query a window instead of the collection, for example `where date == today` or `raisedAt >= now - 24 h` (both are index-backed), so a poll reads tens of documents.
2. Memoise `state/current` and the actions query in process for 10 to 15 seconds and invalidate on any action write. Reads then depend on the number of busy instances, not on users.
3. Apply the same to `/api/incidents` and `/api/works`.

The table below shows the three situations: as implemented today, cache only, and window plus cache. Do not onboard more than a couple of users before fixing this.

## AI routing

| Tier | Used for | Model source | Default limits |
|---|---|---|---|
| t0 | Short action advice (small context, no free-form question): deterministic templates | none | free, still counted |
| t1 | Kannada translation | `AI_MODEL_T1` / `settings.ai.tiers.t1.model` | 300 output tokens, 8 s timeout |
| t2 | Long action advice, works clash narrative | `AI_MODEL_T2` | 500 tokens, 15 s |
| t3 | Commissioner brief only | `AI_MODEL_T3` | 900 tokens, 30 s, 24 per day, cached per scope and hour |

Every request passes these gates in order (`packages/core/src/ai/router.mjs`): maintenance mode, role permission, tier enabled (a disabled tier falls back to t0 for action advice), per-user daily quota by role (admin 100, commissioner 60, dcp 30, station 20, viewer 0), global daily cap (400 calls), brief cap, cache lookup (answers 24 h, brief 1 h), model call with timeout, usage recorded in `ai_usage/{yyyyMMdd}` with an estimated cost. Model ids are data (`settings/app`) so a deprecated model is a settings change, not a deploy. Defaults ship in code; **the model ids and the per-million-token prices in `settings.ai.prices` are placeholders: check them against Vertex AI before enabling AI.**

Kill switch: admin site (AI and cost) or `POST /api/admin/ai/kill {enabled:false, reason}`. `scripts/seed.sh` seeds AI **off**; pass `--ai-enabled` or flip it in the admin site.

Data sent to the model: operational context only (road names, station names, times, congestion figures). No user emails and no citizen data. Do not paste personal data into free-text fields.

## Paid connectors (Routes API, TomTom)

- Calls per day = probes x runs per day. With `P` enabled probes polled every `intervalMin` inside a window of `W` minutes: `calls/day = P x floor(W / intervalMin)`. Example: 14 probes, 30 min interval over the 17 hour day window: 14 x 34 = 476 calls, just inside the default cap of 500. At the default 10 min tick interval the same probes would make 1,442 calls and the cap would silently truncate the run: set `intervalMin` deliberately.
- Start in `shadow` mode: observations are fetched and counted but not persisted, so you see volume and quality before they change the model.
- The budget kill switch disables these connectors automatically (`disabledReason: "budget kill"`); re-enabling is a manual admin action.

## Budget kill switch

1. A Cloud Billing budget (`budget_amount`, thresholds 50, 80 and 100 percent) publishes every update to Pub/Sub `blr-budget`.
2. Push subscription `blr-budget-push` calls `POST /internal/budget` on the worker with an OIDC token from `blr-invoker`.
3. The worker parses `costAmount` and `budgetAmount`. Below 1.0 it does nothing. At or above 1.0 it sets `settings/app.ai.enabled=false` with `killReason`, disables enabled `google_routes` and `tomtom` connectors, and writes an audit row `budget_kill`.
4. Email notices at 50 and 80 percent go to billing admins (and to the monitoring channel if set).

Limits to understand: billing data lags by hours, so this is a backstop, not a hard stop. It does not turn off Cloud Run, Firestore or Hosting; those are bounded by `max_instance_count`, TTLs and the request volume of at most a few hundred users. A budget does not stop spending by itself; only this subscriber does, and it acts on AI and paid connectors only.

Creating the budget needs billing-account permission (`roles/billing.costsManager` on the account). Terraform creates it only if `create_budget = true`. Manual alternative: Console, Billing, Budgets & alerts, Create budget, scope to the project, amount, thresholds 50/80/100, enable "Connect a Pub/Sub topic" and choose `blr-budget`. Verify after creation with `scripts/doctor.sh`.

## Worked monthly estimate

Volumes are computed from the assumptions; prices are ranges to replace with current list prices.

### Assumptions

| # | Assumption |
|---|---|
| A1 | Each user keeps the control app in a visible tab 8 h a day, 22 working days a month |
| A2 | Client poll every 30 s (default `pollMs`). Each poll calls `/state`, `/actions`, `/works`, `/incidents`, plus `/ai/quota` every second poll and `/me` every fourth: 4.5 requests. That is 21,120 polls and 95,040 requests per user per month |
| A3 | Firestore reads per poll: state 1, works 10, incidents 30, actions 1,000 **as implemented** (once the history exceeds 1,000 actions, about 20 to 50 working days at tens of actions a day) or 30 with a time-window query. Totals: 1,041 as implemented, 71 with the window query |
| A4 | Worker: 110 ticks a day (103 in the 05:30 to 22:30 IST window, 7 hourly) about 3,300 a month at 6 s of CPU each; 96 checks a day about 2,900 a month at 2 s each. Worker reads about 0.4M a month, writes about 25k |
| A5 | API bills about 0.06 s of one vCPU per request (CPU only while handling requests) |
| A6 | AI: 5 requests per user per working day, split 50 percent t0, 20 percent t1, 30 percent t2, plus briefs: 120, 240 and 528 a month (528 = 3 scopes x 8 h x 22 d). Tokens in/out: t1 600/150, t2 1,200/350, t3 3,000/700. Prices: the placeholders in `settings.ai.prices` (USD per 1M tokens in/out: t1 0.1/0.4, t2 0.3/2.5, t3 1.25/10) |
| A7 | Page loads: 1.5 full loads per user per working day at about 0.5 MB (gzip) |
| A8 | Unit price ranges, **all to be verified**: Cloud Run vCPU-s 0.000018 to 0.000030 USD, GiB-s 0.000002 to 0.0000035, requests 0.30 to 0.60 USD per million; Firestore reads 0.03 to 0.10 USD per 100k |
| A9 | Free tiers assumed (verify): Cloud Run 180,000 vCPU-s, 360,000 GiB-s, 2M requests a month; Firestore 50,000 reads and 20,000 writes a day, 1 GiB; Hosting 10 GB transfer a month; first 3 Scheduler jobs per billing account free; Identity Platform monthly-active-user free tier; Cloud Logging free monthly ingestion allotment |

### Volumes (formulae: users x per-user figure, plus worker)

| | 10 users | 50 users | 200 users |
|---|---|---|---|
| API requests / month (U x 95,040) | 0.95M | 4.75M | 19.0M |
| Cloud Run vCPU-s (API 0.06 s/req + worker 25.6k) | 83k | 311k | 1,166k |
| Cloud Run GiB-s (API 0.5 GiB, worker 1 GiB) | 54k | 168k | 596k |
| Firestore reads, **as implemented today** (U x 21,120 x 1,041 + 0.4M) | 220M | 1,100M | 4,398M |
| Firestore reads, 15 s cache only (busy instances x 42,240 x 1,041 + 0.4M; 1 / 2 / 3 instances) | 44M | 88M | 132M |
| Firestore reads, window query, no cache (U x 21,120 x 71 + 0.4M) | 15M | 75M | 300M |
| Firestore reads, **window query + 15 s cache** (busy instances x 42,240 x 71 + 0.4M) | 3.4M | 6.4M | 9.4M |
| AI requests / month (U x 110) | 1,100 | 5,500 | 22,000 |
| Model calls (t1 + t2 + briefs) | 670 | 2,990 | 11,528 |
| Hosting transfer (U x 22 x 1.5 x 0.5 MB) | 0.17 GB | 0.8 GB | 3.3 GB |

At 200 users the model-call demand (about 524 a day) exceeds the default global cap of 400, so the cap, not the budget, limits spend; raise `dailyCallCap` deliberately if you want it higher.

### Cost (USD per month, ranges, before tax)

| Line | 10 users | 50 users | 200 users | Basis |
|---|---|---|---|---|
| Cloud Run (API + worker) | 0 | 3 to 6 | 23 to 41 | volume above the free tier x A8 |
| Firestore reads, **as implemented today** | 66 to 219 | 330 to 1,098 | 1,319 to 4,396 | (reads minus 1.5M free) / 100k x A8 |
| Firestore reads, 15 s cache only | 13 to 43 | 26 to 87 | 39 to 131 | same formula |
| Firestore reads, window query, no cache | 4 to 14 | 22 to 74 | 90 to 299 | same formula |
| Firestore reads, **window query + 15 s cache** (recommended) | 0.6 to 1.9 | 1.5 to 4.9 | 2.4 to 7.9 | same formula |
| Firestore writes and storage | 0 | 0 | 0 | well inside the free tier |
| Gemini at placeholder prices | about 1.7 | about 4.8 | up to about 14 (cap-limited) | model calls x per-call cost: t1 0.00012, t2 0.0012, t3 0.011 USD |
| Hosting, Identity Platform, Monitoring, Logging | 0 | 0 | 0 | inside assumed free tiers |
| Scheduler (6 jobs) | 0 to 0.5 | 0 to 0.5 | 0 to 0.5 | 3 jobs billable x per-job price |
| Artifact Registry, Secret Manager, GCS | 0 to 1 | 0 to 1 | 0 to 1 | small storage |
| Routes / TomTom | 0 | 0 | 0 | off by default; if on: calls/day x 30 x per-call price, bounded by `caps` (default 500 a day) |
| **Total, recommended fix (window + cache)** | **about 2 to 5** | **about 9 to 17** | **about 39 to 64** | non-Firestore lines plus the recommended Firestore row |
| Total, cache only | about 15 to 46 | about 34 to 100 | about 76 to 188 | |
| Total, as implemented today | about 68 to 222 | about 338 to 1,110 | about 1,356 to 4,453 | |

Hard AI ceiling at default settings, regardless of users: 24 briefs and 376 t2 calls a day is about 21.7 USD a month at the placeholder prices (400 calls a day cap, brief cap 24). Compute ceiling: `api_max_instances` x 1 vCPU x 730 h at the worst case is a bound you can calculate from current Cloud Run prices; reaching it needs sustained saturation.

Reading the table: Cloud Run, Hosting and the Scheduler are noise at this scale. Gemini is bounded by its caps. **Firestore reads are the line that can run away, and today nothing bounds them except the budget kill, which does not stop reads.** Fix the actions query before real use.

## Where to look when the bill moves

1. Billing, Reports, group by SKU (reads vs Cloud Run vs Vertex AI).
2. Admin site, AI and cost: calls, tokens, cache hits and estimated cost per day (`ai_usage`).
3. Admin site, Connectors: `cost.calls` on each run, and today's counter against the cap.
4. Cloud Run metrics for `blr-api`: instance count and request count.
