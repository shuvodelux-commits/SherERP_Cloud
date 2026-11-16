# M08 Cash Reconciliation Candidate Selection — Execution Plan

**GitHub-first, TDD, KISS:** new M08 branch and one PR; pinned Mohim_ERP source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Related spec: `docs/superpowers/specs/2026-11-16-m08-cash-candidate-selection-design.md`.

**Goal:** source-parity internal Cash Book candidate projection, with explicit stale-link and reused-entry exclusion, no financial writes.

**Constraints:** no D1, auth/RPC integration, schema, legacy source, original frontend, preview bindings, or production data changes. Do not modify cross-role Party account buckets or enable settlement.

### Task 1 — RED tests

**Create** `tests/m08-cash-reconciliation-candidates.test.mjs`.

- Build a frozen-source oracle by selecting GAS `getCashReconciliationCandidates`, `cashReconciliationBuildRows_`, `cashReconciliationLinkedUsage_`, related helpers, and `Utils.gs` date/money functions with synthetic VM stubs for `requirePermission_`, `getAllRows_`, `ok_`/`fail_`, `logError_`, `Session`, `Utilities`.
- Write acceptance cases for cash-in/out, retained selection, invalid/stale/deleted/synthetic/wrong-direction links, duplicate link across sessions/phases, text search, sort/tiebreak/cap 250, original error payloads, frozen arrays and refused unresolved Promise.
- Add defensive corrupted-ID tests (duplicate session or cash entry IDs rejected; prototype-shaped IDs don't exploit map).
- Commit tests before module exists; trigger PR Actions and **inspect failed test logs** to prove `ERR_MODULE_NOT_FOUND`.

### Task 2 — GREEN implementation

**Create** `src/modules/m08-cash-reconciliation-candidates.js`.

- Export `projectCashReconciliationCandidates(sessionRows,cashRows,{sessionId,phase,query='',timeZone})` returning original successful payload.
- Reuse `projectCashReconciliationSessions`, `evaluateCashExplanation` and `safeSourceDateOnly`. Use `Map`, `Set`, original sign and sort rules.
- Fail closed on unloaded arrays and duplicate nonempty source IDs, never guess financial identity.
- Commit minimal code. Verify complete Node test run, relevant source/build steps, CI and PR file scope; do not equate test-only GAS oracle to real D1 integration.

### Task 3 — PR review

- Record RED/GREEN commits, actual GitHub run outcomes, source SHA, file inventory and unmigrated boundaries.
- PR stays unmerged until owner review and applicable checks are green; revert safely with no data migration if necessary.
