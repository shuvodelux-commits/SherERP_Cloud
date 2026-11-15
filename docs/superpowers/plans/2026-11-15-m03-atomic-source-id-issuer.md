# Superpowers TDD — isolated Workerd/D1 source ID issuer

**Branch:** `feat/m03-atomic-source-id-issuer-local-20261115` from current `main`.
**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/MIGRATION_PLAN.md`, pinned `Utils.gs` / `Config.gs`, and merged PR #186 high-water preflight.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-atomic-source-id-issuer-design.md`.

1. Inspect latest repo and M03-core ownership, open PRs, fixed synthetic Workerd fixtures and source prefix/increment. Do not change shared `migrations`, `src/index.js`, auth, RPC or already-owned D1 modules.
2. **RED:** Add `tests/m03-atomic-source-id-issuer.test.mjs` and local D1 integration test first, with isolated SQL fixture and Worker/config referencing missing `src/db/atomic-source-id-issuer.js`. Register test via one import in existing `tests/integration/m03-workerd.spec.mjs`. Commit and show GitHub Foundation missing-module failure (other native Workerd tests may fail for same reason before GREEN).
3. **GREEN:** Implement only `src/db/atomic-source-id-issuer.js` with one fixed idempotent receipt INSERT, followed by fixed readback. No process lock, no implicit tenant, no dynamic identifiers, no silent D1 failures. Error handling fail-closed; immutable trigger guarded by test-only schema.
4. Verify exact-head Node, source and 36-include build, the new actual Workerd/D1 test, M01 Chromium, M02/M04 local Workerd, Cloudflare PR safety. Investigate any failure, new test first for discovered defects, small fixes, run all.
5. Open/update small PR detailing source pin, RED/GREEN evidence, exact files/RPC/table impact, no production table, test-only and future integration gates; ensure no overlapping files in current `main`. Leave for user review and merge; no database activation.

**Touched:** two new docs, new internal module, new Node test, new synthetic D1 schema, new test-only Worker/config/integration test, **one additive import** in test aggregator. **No live D1 migration** or transaction module changes. 
