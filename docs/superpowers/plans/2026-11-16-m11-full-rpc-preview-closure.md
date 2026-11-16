# M11-07 — Complete source RPC preview-denial coverage (2026-11-16)

**Issue:** #306. **Target base:** `SherERP_Cloud/main@423edb7ad1c7e1e44d6401dd34cb034b95130cea`. **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Depends on merged:** #309, #318, #328, #338, #345, #355. Read AGENTS.md, ADR-007, WORKSTREAMS.md, MIGRATION_PLAN.md and M11 cutover runbook before continuing.

## Twelve-sentence implementation overview

1. M11's public preview smoke currently checks eight representative RPCs, which does not cover all original browser-callable ERP methods.
2. The pinned M00 inventory contains 129 distinct literal RPC names and the dynamic closure adds 16 distinct names, for 145 unique browser-callable methods.
3. M11-07 will use those two existing, immutable source-inventory artifacts to build a deterministic preview-denial target list without manually duplicating method names.
4. An extractor will validate each inventory's version, frozen source SHA, count totals, unique method names and exact reviewed target structure, failing closed on malformed or stale artifacts.
5. The existing M11 public preview smoke will continue to exercise health, assets, API routing, response headers and a trap for attempted access to Worker environment bindings.
6. It will additionally send synthetic requests to **every** reviewed browser RPC name and require the public Worker to respond with the existing controlled non-success envelope.
7. The login method is special-cased only for its existing 503 unavailable status; other source names must return the existing 501 not-migrated status.
8. A static guard will reject any nonempty public Worker RPC registry even if a handler happens to reject the specific synthetic test arguments.
9. Tests will prove that a formerly unprobed method, a dynamic-only method and a populated registry cannot evade the check.
10. Test-first GitHub CI must show the expected missing-helper-module RED before the minimal implementation and existing smoke update turn GREEN.
11. The same PR-only no-secrets Cloudflare preview workflow will run this expanded test automatically with no additional deployment pathway or external data.
12. This is **local synthetic preview testing only**, not real Cloudflare availability, actual M10 reconciliation, production readiness or authority to migrate or switch traffic.

## Scope and acceptance

- **New:** `tests/m11-preview-rpc-closure.test.mjs` (RED), `scripts/m11-preview-rpc-closure.mjs` (GREEN), this plan.
- **Updated:** `scripts/check-m11-preview-runtime.mjs` to consume checked M00 artifacts and reject a nonempty public registry; `docs/runbooks/M11_PRODUCTION_CUTOVER.md` to document 145-method coverage and its limits.
- **Unchanged:** `src/index.js`, `src/rpc/handler.js`, `src/rpc/registry.js`, `legacy/source`, source snapshots, `wrangler*.jsonc`, Cloudflare deployment/PR workflow, D1 schema/migrations, posting kernel, real business data and credentials.
- **Tests:** actual pinned inventory extraction, malformed/tampered inventory rejection, dynamic-only RPC dispatch mutant, literal non-representative RPC mutant, nonempty registry mutant, and original Worker green.
- **Review:** full exact-head GitHub CI with existing Workerd/D1/Playwright checks; draft PR until green and owner merge. Revert PR as rollback; no production writes or migration.
