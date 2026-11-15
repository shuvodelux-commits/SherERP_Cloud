# Superpowers TDD — source-count validation

1. Read AGENTS.md, ADR-007, current Party reconciler and tests; inspect open M02 PRs for path overlap.
2. **RED Node:** add explicit tests to `tests/m02-party-import-readback.test.mjs`. Generate known-valid reviewed plan and future-schema mirrored readback; tamper `summary.quarantinedRows` and `summary.sourceRows` to matching negative/fractional pairs, prove `PLAN_COUNT_MISMATCH`, identityRowsMatch=false, no leaked IDs, no mutation. A valid plan must still audit cleanly.
3. **RED actual Workerd/D1:** add one regression to `tests/integration/m02-party-plan-workerd.spec.mjs`. Use real read-only D1 readback of existing synthetic import; set negative quarantined rows and correspondingly lower sourceRows. Require `PLAN_COUNT_MISMATCH` and unchanged D1 counts. Commit tests before production implementation and capture expected GitHub RED failures.
4. **GREEN minimal:** add `Number.isSafeInteger` and nonnegative guards for these two summary fields to the existing count mismatch branch in `src/party/import-readback-reconciliation.js`. Preserve approval evidence persistence and all existing diagnostics.
5. Verify Node, 84 source files, 36 original UI includes, M02/M03/M04 local Workerd/D1, M01 browser and Workers PR-safety CI. Keep PR draft until CI completes; no production import.
