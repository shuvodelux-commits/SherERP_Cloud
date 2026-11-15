# Superpowers TDD — M03 ID and posting coupled in D1

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Design:** `docs/superpowers/specs/2026-11-15-m03-id-posting-atomic-proof.md`.
**Branch:** `feat/m03-id-post-atomic-proof-20261115` from `main` after merged PR #194.

1. Confirm `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md` and original `generateId_` behavior. Read #194's actual immutable receipt schema and Workerd harness, check concurrent PR ownership. Do not touch shared migrations, `src/index.js`, auth/RPC or original UI.
2. **RED:** Commit `tests/m03-id-post-atomic-proof.test.mjs`, `tests/integration/m03-id-post-workerd.spec.mjs`, new local D1 schema, fixed Worker/config and one additive import in `tests/integration/m03-workerd.spec.mjs` BEFORE implementation. Assert new `src/db/atomic-source-id-posting-proof.js` missing through GitHub Foundation; include real D1 tests of success, concurrent replay, lost response, stock exhaustion, journal failure injection, non-resurrection and client-body denial.
3. **GREEN:** Implement only `src/db/atomic-source-id-posting-proof.js`. Fixed source SALES ID family, reuse `createAtomicSourceIdIssuer`, fixed tenant-scoped journal readback and fail-closed shape/source-ID consistency check. Do **not** run separate JavaScript stock adjustment, independent ID allocation or emit public RPC.
4. Run exact-head GitHub Foundation, source pin/assembly, M01 Chromium, existing M02/M04 local D1, new M03 Workerd/D1 integration; inspect logs including the new test results and resolve any failures on this branch. Clear differences between model tests and real Workerd D1 tests.
5. Update draft PR with RED/GREEN commit/job links, changed file table, NO production migration/deploy, remaining shared schema/financial gates, rollback. Compare latest `main` for overlap and leave merge to user-approved review.

**Files:** new 2 docs, 1 internal module, Node test, local fixture schema/Worker/config/Workerd spec, 1 additive import to existing M03 Workerd aggregator; no other file ownership overlap. 
