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

Deploy order and first-time setup are in the README. Terraform has not been applied in the authoring environment: read `terraform plan` before the first apply.
