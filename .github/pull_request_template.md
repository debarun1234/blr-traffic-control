## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `npm run lint && npm test` pass locally
- [ ] API change? `docs/api-contract.md` updated first, and both apps/api and the web apps follow it
- [ ] Infra change? `terraform fmt` and `terraform validate` pass; plan reviewed (no unexpected destroy/replace)
- [ ] No secrets, keys or real citizen data in the diff (no JSON service-account keys, ever)
- [ ] Anything new that costs money (API calls, instances, jobs) has a cap and a documented kill switch
- [ ] Docs updated if behaviour, setup or runbook steps changed

## Risk and rollback

<!-- What can go wrong, and how to undo it (usually: scripts/rollback.sh). -->
