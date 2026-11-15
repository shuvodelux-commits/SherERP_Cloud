# M02-safe source row position — Superpowers TDD execution plan

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Design:** `docs/superpowers/specs/2026-11-15-m02-safe-source-row-provenance.md`.

1. **Inspect:** `AGENTS.md`, ADR-007, `src/party/party-import-plan.js`, `tests/contract/party-approval-evidence.test.mjs`, `tests/fixtures/m02-party-plan-batch.mjs`, `tests/integration/m02-party-plan-workerd.spec.mjs`. Do not alter shared schema/kernel or staging/prod data.
2. **RED:** Add a contract test demonstrating a source position greater than the maximum safe JS integer passes the old `Number.isInteger` validation. Demand rejection with the existing `Invalid legacy row position` diagnostic; accept `Number.MAX_SAFE_INTEGER` and unchanged original row 2. Add a real Workerd/D1 synthetic preflight no-write test checking unsafe source row prevents even preparing D1 import statements. Commit tests before implementation. Observe the expected Github Foundation and M02 synthetic D1 CI failures.
3. **GREEN:** Change exactly one source-row predicate to `!Number.isSafeInteger(legacySheetRow)` in `src/party/party-import-plan.js`. Do not edit D1 SQL, approved source IDs, roles, review evidence or money.
4. **Verify:** GitHub current-head Foundation Node, M02 real Workerd/D1, 84 frozen source file manifest, 36 frontend includes, all eight GitHub Actions, and current-main branch reconciliation. PR includes RED/GREEN evidence; no production Party import activation.
