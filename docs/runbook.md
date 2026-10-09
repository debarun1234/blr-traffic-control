# Runbook

| Situation | Action |
|---|---|
| Health unknown | `scripts/doctor.sh --env <env>` (read-only), then Admin > System checks |
| Bad release | `scripts/rollback.sh --env <env>` (previous Cloud Run revisions) |
| Costs rising | Admin > AI: disable AI or lower caps; disable paid connectors; check the billing budget. The Pub/Sub budget trigger does this automatically at 100% |
| Connector failing | Admin > Connectors > runs; the circuit breaker pauses it; fix, then re-enable (start in shadow) |
| Stale map ("stale since" pill) | Check the scheduler jobs and worker logs; fall back to the `sim` connector |
| Lock-out (no admin) | `scripts/admins.mjs` lists admins; `scripts/seed.sh --admin-email <you>` creates one |
| Leaked key or secret | Revoke the API key in Admin; `scripts/set-secret.sh --rotate`; rotate the Google OAuth secret |
| Maintenance | Set the maintenance flag in Admin > Settings (non-admins see a maintenance screen) |
| Teardown | `scripts/teardown.sh --env <env>` (read the prompt; `delete_protection` guards Firestore) |

## GitHub Actions configuration

The `Deploy` and `Deploy web only` workflows use Workload Identity Federation (no JSON keys). Set these in the GitHub environment (`dev` / `prod`):

| Variable | Meaning |
|---|---|
| `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` | Workload Identity provider and deployer service account, printed by `scripts/bootstrap.sh` |
| `TF_STATE_BUCKET` | Terraform state bucket (`<project>-tfstate`) |
| `TFVARS` | The full contents of your `dev.tfvars` / `prod.tfvars` (project, admin emails, OAuth client id (not the secret), budget, optional `maps_browser_key` and `maps_map_id`). Git-ignored locally; never commit it |

The OAuth client secret is a GitHub **secret**, not a variable: `TF_VAR_OAUTH_CLIENT_SECRET`. Do not put `oauth_client_secret` in `TFVARS`: variables are stored and shown in plain text, and the tfvars file would override the secret. `Deploy` fails fast with a clear message if a variable is missing.

### Google sign-in (one manual step)

Identity Platform needs a Google OAuth Web client, which cannot be created by Terraform. In the Cloud console: APIs & Services > Credentials > Create OAuth client ID (Web). Put the client id in `oauth_client_id` (in `TFVARS`) and the secret in `TF_VAR_OAUTH_CLIENT_SECRET`. After the first Deploy add `https://<value>/__/auth/handler` to the OAuth client's authorised redirect URIs, for each `auth_domain_*` Terraform output. If a secret is ever exposed, create a new one, update `TF_VAR_OAUTH_CLIENT_SECRET`, redeploy, and delete the old one.

## Frontend-only deploys

`Deploy web only` (`.github/workflows/deploy-web.yml`) rebuilds the two static sites and publishes them to Firebase Hosting: lint, tests, build, `firebase deploy --only hosting`, smoke test. No Terraform apply, no Docker, no Cloud Run change; about 2 minutes.

- Push to `main` that touches `apps/control/src`, `apps/admin/src`, `packages/ui`, `packages/shared`, `packages/mapdata`, or the hosting/rules files deploys to **dev** automatically.
- Manual: Actions > Deploy web only > Run workflow > dev or prod.
- Use the full `Deploy` workflow when API, worker, packages/core, Terraform or Firestore rules/indexes change.
- Locally: `scripts/deploy.sh --env dev --skip-terraform --skip-build`.

Deploy order and first-time setup are in the README. Terraform has not been applied in the authoring environment: read `terraform plan` before the first apply.

## Sign-in flow and the welcome screen

After an interactive Google sign-in both sites show a welcome screen before the dashboard: a greeting by name (different copy and layout for Commissioner, DCP, Station, Viewer, Administrator on Control, and the Admin console), then pre-entry checks: connection, data feed, AI assistant, and for administrators system health and connectors. Checks never block entry; a failed one is shown and the person can continue.

- `POST /api/preflight` (any signed-in role) returns the check results and a snapshot scoped to the person's jurisdiction.
- The AI probe (one tiny tier-t1 call) runs at most **once per IST day for the whole system**; the result is stored in `checks/ai-<day>` and shared by everyone who signs in that day. A failed probe is retried after 30 minutes. If AI is off, over budget or unconfigured, no model call is made.
- Administrators also trigger the daily full system-check run (`checks/latest`) if it has not run yet today.
- A page refresh with a live session goes straight to the dashboard. In dev mode the welcome screen only appears with `?welcome=1` (or `welcome: true` in config.js).
