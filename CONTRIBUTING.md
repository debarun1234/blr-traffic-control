# Contributing

Node 22, ESM, JSDoc, no bundler. Before a PR: `npm run lint && npm test && npm test --prefix apps/control && npm test --prefix apps/admin`. Changes to roles or permissions go in `packages/shared` with tests. API shape changes update `docs/api-contract.md` first. Do not hard-code model ids or prices. Keep UI strings in both English and Kannada.
