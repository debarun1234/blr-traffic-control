# Security

Status: proof of concept. The controls below are implemented in code and Terraform unless listed under [Not done yet](#not-done-yet). **Do not put real operational use on this system before the items in that section are closed, in particular an independent VAPT.**

## What is protected

| Asset | Sensitivity | Where |
|---|---|---|
| Staff identities (email, name, role, station) | Personal data of employees | `users`, `audit` |
| Action and incident records | Operational, internal | `actions`, `incidents`, `works` |
| Audit trail | Integrity-critical | `audit` |
| Connector credentials (Routes, TomTom, agency APIs) | Secret | Secret Manager `blr-connector-*` |
| Ingest API keys | Secret (stored as SHA-256 only) | `apikeys` |
| OAuth client secret | Secret | Secret Manager `blr-oauth-client-secret`, Terraform state |
| Terraform state | Contains the OAuth client secret | `gs://<project>-tfstate` (private, versioned) |
| Modelled traffic state | Low (derived, not measured) | `state/*` |

**No citizen personal data is stored.** There are no plate numbers, names, phone numbers or locations of individuals. Crash statistics are station-level aggregates; incidents are an edge (road segment) id, a type and a time window. The one leak path is free text: `note` fields and incident titles typed by officers. Staff must be told not to enter plate numbers or names; the [integration guide](integration-guide.md) forbids mapping plate fields from ANPR.

## Threat model

Trust boundaries: Internet to Hosting/API; API to Google services; Scheduler/Pub/Sub to worker; API/worker to external hosts (connector URLs, admin supplied).

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | Unknown person signs in | Allowlist: no `users/{email}` doc or `active:false` gives 403 on every route; Google sign-in only; email password, phone and anonymous disabled in Identity Platform | A Google account on the allowlist that is phished is a valid user (see MFA below) |
| T2 | Forged or replayed ID token | `verifyIdToken` against Google keys; 1 hour expiry; user cache 60 s | Stolen live token works until expiry unless the refresh token is revoked |
| T3 | Privilege escalation | Role and jurisdiction checked server-side on every write; an admin cannot demote themselves; the last admin cannot be removed; UI dimming is cosmetic | Bugs in the checks; covered by unit tests, not by an external review |
| T4 | `AUTH_MODE=dev` shipped | API refuses to start with it when `NODE_ENV=production`; `scripts/lint.mjs` fails the build if it appears in infra, workflows, Dockerfiles; `/api/admin/checks` reports it as `fail` | None known |
| T5 | Direct database access from a browser | `firestore.rules` is `allow read, write: if false`; only service accounts (Admin SDK) reach Firestore | Anyone who obtains a service-account token |
| T6 | Worker called by the internet | Ingress `internal`; no `allUsers` invoker; `/internal/*` also verifies the OIDC email equals `INTERNAL_INVOKER_SA` | None known |
| T7 | Direct hit on the `*.run.app` URL, bypassing Hosting | Allowed by design (Hosting cannot send tokens). Every route authenticates in the app; headers are also set by the API | Unauthenticated endpoints are only `/healthz` and `/readyz`; scanners can reach them. No WAF |
| T8 | SSRF through admin-defined connector URLs | One outbound path (`createSafeFetch`): https only in production, no credentials in URLs, DNS resolved and every address checked against loopback, private, link-local (incl. `169.254.169.254` metadata), CGNAT, multicast, reserved and IPv4-mapped IPv6 ranges, redirects refused, timeout and response-size caps (5 MB max), per-connector and global daily call caps | DNS rebinding between check and connect is narrowed, not eliminated (no pinned-IP dialer). Only admins can create connectors |
| T9 | Secret exfiltration through the API | `secretRef` is a name only; values are never returned, logged (redacted) or stored in Firestore; connector `config` rejects keys such as `secret`, `token`, `authorization`; REST headers named `authorization`/`x-api-key` are refused | A malicious admin can point a connector at their own https host and the credential header goes there. Mitigation: few admins, audit rows, review `secretRef` assignments |
| T10 | Ingest abuse (external systems) | `x-api-key` on `/ingest/v1/*` only; keys scoped (`events`, `speeds`, `works`), SHA-256 at rest, constant-time compare, per-key rate limit, batch caps, idempotent on `externalId` | Rate limiting is in memory per instance: with max 3 instances the effective limit is up to 3 times the configured value |
| T11 | Cost abuse (AI, paid APIs) | Kill switch, daily and per-user quotas, per-day call caps, `max_instance_count`, billing budget kill ([cost-and-ai.md](cost-and-ai.md)) | A budget alert lags real spend by hours |
| T12 | XSS and clickjacking | CSP without `unsafe-eval` (the Control site allows `'wasm-unsafe-eval'` and Google hosts only because the optional Google Maps basemap needs them; Admin does not) and without `unsafe-inline` for scripts (hash for the one inline theme script, enforced by `lint.mjs`), `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy`, COOP `same-origin-allow-popups` (needed for the Google popup) | `style-src 'unsafe-inline'` is allowed because the apps use inline styles |
| T13 | Supply chain | Dependabot (actions, npm, terraform, docker); lockfile; workflow actions pinned to commit SHAs; `firebase-tools` pinned; secret scan in CI | No SBOM, no image signing, no container vulnerability gate, base images not pinned by digest |
| T14 | Tampering with the audit trail | The application never updates or deletes `audit`; every admin mutation and every transition writes a row | **Not enforced by IAM.** The runtime service accounts hold `roles/datastore.user`, which can delete documents. See below |
| T15 | Compromised CI | Workload Identity Federation limited to one repository (attribute condition); no JSON keys anywhere; `prod` deploys gated by GitHub environment reviewers | The deployer service account is highly privileged (below) |

## Authentication and authorisation

1. Identity Platform authenticates with Google. It issues no authorisation.
2. The API loads `users/{email}` (lowercased). No doc or `active:false` returns 403. `BOOTSTRAP_ADMIN_EMAILS` are admin even without a doc; keep it to one or two people and remove entries once real admins exist (it is a Terraform variable).
3. Roles: `admin`, `commissioner`, `dcp` (one region), `station` (one station), `viewer`. Permissions and jurisdiction come from `@blr/shared`, the same module the browser uses, so UI and server cannot drift.
4. Revoking access: set the user `active:false` (effective within about 60 s). To also kill a live session, revoke refresh tokens in the Identity Platform console.

## Least-privilege IAM

| Principal | Roles | Scope | Why |
|---|---|---|---|
| `blr-api@` (runtime) | `roles/datastore.user` | project | Firestore read/write |
| | `roles/aiplatform.user` | project | Gemini on Vertex AI |
| | `roles/logging.logWriter` | project | Logs |
| | `roles/secretmanager.secretAccessor` with condition `resource.name.startsWith("projects/<number>/secrets/blr-connector-")` | project, conditional | Test connectors; cannot read the OAuth secret or any other secret |
| | `roles/storage.objectUser` | the data bucket only | Exports and uploads |
| `blr-worker@` (runtime) | `roles/datastore.user`, `roles/logging.logWriter` | project | State, actions, retention |
| | `roles/secretmanager.secretAccessor` (same condition), `roles/storage.objectUser` (bucket) | as above | Run connectors; exports |
| `blr-invoker@` | `roles/run.invoker` on `blr-worker` only | service | Scheduler and Pub/Sub push call the worker |
| Pub/Sub service agent | `roles/iam.serviceAccountTokenCreator` on `blr-invoker@` | service account | Mint OIDC tokens for push |
| `allUsers` | `roles/run.invoker` on `blr-api` only | service | Hosting rewrites carry no identity token. Turn off with `api_allow_unauthenticated = false` only if you front the API differently |
| `blr-deployer@` (CI and bootstrap) | `run.admin`, `iam.serviceAccountAdmin`, `iam.serviceAccountUser`, `resourcemanager.projectIamAdmin`, `serviceusage.serviceUsageAdmin`, `firebase.admin`, `firebasehosting.admin`, `datastore.owner`, `secretmanager.admin`, `storage.admin`, `artifactregistry.admin`, `cloudscheduler.admin`, `pubsub.admin`, `monitoring.admin`, `logging.admin`, `identityplatform.admin` | project | Terraform manages all of these resource types |

No service account keys are created by Terraform or the scripts, and `lint.mjs` fails on `google_service_account_key`, `roles/owner`, `roles/editor` and on `credentials_json` in workflows.

**Deployer identity.** `projectIamAdmin` lets the deployer grant itself anything, so treat it as project admin. Controls: the WIF provider only accepts tokens whose `repository` claim equals your repo; `prod` is a GitHub environment with required reviewers; branch protection and CODEOWNERS on `infra/`, `.github/`, `scripts/`. Splitting a read-only plan identity from an apply identity is on the [roadmap](roadmap.md).

## Secrets handling

- Connector secrets: `scripts/set-secret.sh --id <id>` (hidden prompt, stdin or file; never an argument). Name `blr-connector-<id>`. Rotation: run it again with `--rotate`, which adds a version and disables older ones. The API stores only the name (`secretRef`).
- OAuth client secret: supplied as `TF_VAR_oauth_client_secret` (local) or the GitHub environment secret `TF_VAR_OAUTH_CLIENT_SECRET`; stored in Secret Manager and, unavoidably, in Terraform state, which is why the state bucket is private, versioned and has public access prevention. The `google.com` provider config in Identity Platform needs the value too.
- Firebase web `apiKey` is public by design (it is in `config.js`). Restrict it to your Hosting domains and to the Identity Toolkit and Token Service APIs in the Cloud Console, API credentials page.
- Ingest API keys are shown once at creation and stored as SHA-256.
- `scripts/lint.mjs` and gitleaks (CI) look for committed secrets.

## Audit

Every admin mutation, action transition, incident report, budget kill and automatic escalation or verification writes an `audit` row `{at, actor, role, kind, target, summary, ip?, meta?}`. The admin site lists and exports them (`audit.csv`).

**Immutability is by convention, not enforcement**: the code never updates or deletes audit rows, and no endpoint does, but a compromised runtime service account could. Hardening not yet done: enable Firestore Data Access audit logs and route them to a bucket with a retention lock, or mirror `audit` to BigQuery with a locked dataset. Until then, treat the audit trail as strong evidence of normal operation, not as tamper-proof.

## Retention

| Data | Retention | Mechanism |
|---|---|---|
| `state_hist`, `probe_obs`, `connector_runs`, `ai_cache`, `counters` | 72 h, 7 d, 14 d, 24 h, 3 d | Firestore TTL on `expireAt`, plus the nightly `/internal/retention` sweep |
| GCS exports and uploads | 30 d | Bucket lifecycle |
| Container images | 10 newest; others older than 30 d | Artifact Registry cleanup policy |
| Audit, actions, incidents, users | Indefinite | Decide a policy with the owning department; none is enforced |
| Cloud Logging | Default bucket retention (30 d) | Raise or export if evidence must be kept longer |

## Incident response

1. **Detect**: alert email (5xx burst, feed stale, tick failures, `/readyz` down, kill switch), `scripts/doctor.sh`, unusual audit rows.
2. **Contain** (fastest first):
   - Suspected user compromise: set `active:false` in the admin site; revoke refresh tokens in the Identity Platform console.
   - Suspected key leak: revoke the ingest key (admin site); for connector credentials rotate at the provider, then `scripts/set-secret.sh --rotate`.
   - Suspected abuse of AI or paid APIs: admin site, AI kill switch; set `caps` to 0; disable the connector.
   - Active attack on the API: set Cloud Run `max instances` to 1 (or `ingress` to `internal` to take the API offline); set `settings.maintenance = true`.
3. **Preserve**: do not delete logs; export `audit` and the relevant Cloud Logging range to a bucket (`gcloud logging read ... > file`). Note times in IST and UTC.
4. **Eradicate and recover**: rotate every secret the affected identity could read; redeploy a known-good tag (`scripts/rollback.sh` or re-run `deploy.yml` on the tag); restore data from a Firestore export if needed ([runbook](runbook.md)).
5. **Review**: write down timeline, cause, what detected it, and the control that failed. File issues for each gap.

Report vulnerabilities per [SECURITY.md](../SECURITY.md).

## CI/CD supply-chain notes

All third-party GitHub Actions are pinned to full commit SHAs, resolved from the upstream tags on 2026-10-07 with `git ls-remote`:

| Action | Tag | Commit |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| `hashicorp/setup-terraform` | v3.1.2 | `b9cd54a3c349d3f38e8881555d616ced269862dd` |
| `google-github-actions/auth` | v2.1.13 | `c200f3691d83b41bf9bbd8638997a462592937ed` |
| `google-github-actions/setup-gcloud` | v2.2.1 | `e427ad8a34f8676edf47cf7d7925499adf3eb74f` |
| `gitleaks/gitleaks-action` | v2.3.9 | `ff98106e4c7b2bc287b24eaf42907196329070c7` |

Nothing is pinned to a major version only. Dependabot proposes SHA bumps weekly. `firebase-tools` is pinned to an exact version (`FIREBASE_TOOLS_VERSION`). Terraform providers are constrained to `~> 6.0`; commit `.terraform.lock.hcl` after the first `terraform init` to pin exact provider builds.

## Not done yet

- **MFA.** Not enforced by this system. Google sign-in delegates it: enforce 2-Step Verification in the Google Workspace (or Cloud Identity) tenant that owns the staff accounts and allow only those domains. Personal Gmail accounts cannot be forced.
- **Independent VAPT** and a code review of authorisation paths. Required before real use.
- **Audit tamper-resistance** (locked log sink or BigQuery mirror), see above.
- **WAF / DDoS policy.** Hosting's CDN absorbs static traffic; the API has app-level rate limits only (per instance). Cloud Armor would need a load balancer in front of Cloud Run.
- **Distributed rate limiting** and per-user session revocation on demand.
- **Container hardening gates**: image scanning gate, digest-pinned bases, SBOM, signing and Binary Authorization.
- **Organisation policies** (domain-restricted sharing blocks `allUsers` on the API; allow an exception for that one service), VPC Service Controls, CMEK.
- **Backups and DR** beyond optional 7-day point-in-time recovery ([roadmap](roadmap.md)).
- **Data protection review** for the department (retention of staff data, access reviews, DPIA if the scope grows).
- **Terraform was not applied against a real project** in the environment where it was written; see the validation notes in the repository report before first apply and read the plan.
