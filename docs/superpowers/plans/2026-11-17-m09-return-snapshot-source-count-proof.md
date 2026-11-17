# M09 historical lineage source-count reconciliation — execution plan

> **Required:** Superpowers RED→GREEN; do not modify the production composer before observing focused RED. GitHub-first workflow, exact-head required CI, KISS.

**Goal:** Prevent a manifest's independently reviewed source/imported count receipt from attesting a different original historical Sales/Purchase/Return snapshot.

**Architecture:** Pure ESM read-only M09 composer change; safe own-data receipt reads; no new library or RPC.

**Base:** main `5ac51572cc3220480cd00841230f07df1c56d924`; dependency #508 merged.
**Spec:** `docs/superpowers/specs/2026-11-17-m09-return-snapshot-source-count-proof-design.md`.

## Ownership
Only `tests/m09-report-source-lineage-evidence.test.mjs`, `src/modules/m09-report-source-lineage-evidence.js`, this plan, spec. M09 lane. Shared D1/RPC/posting/Worker code and original frozen source are prohibited.

## Task 1 — RED
1. Make existing pristine synthetic fixtures truthful by assigning six source/imported receipts from supplied snapshot array lengths.
2. Preserve deliberate existing parent-child mismatch tests by updating their source row receipts when they intentionally append rows.
3. Add tests where six source group receipts are each wrong while importedRows equals sourceRows, ensuring only Sales/Purchase/Profit are blocked.
4. Add deleted-source-row counting, independent simultaneous wrong-link+wrong-count, receipt accessor safety, output redaction and original unchanged tests.
5. Commit tests + design + plan on a branch from exact main without changing the composer.
6. Verify **observed** RED from exact commit (local isolated Node and/or Actions); record failures proving the missing count binding.

## Task 2 — GREEN
1. Read only own-data descriptors for snapshots and reviewed group receipts; require previously audited valid source array shape.
2. Compare each of the six full historical array lengths against corresponding trusted nonnegative integer `sourceRows`.
3. Emit fixed `<GROUP>_SOURCE_ROWS_MISMATCH` blockers only; do not leak names, IDs, amounts or counts. Existing invalid receipt groups remain blocked by source eligibility.
4. Combine mismatch blockers with existing Sales/Purchase return issues in stable order; return `ready:false` for every report, even with all checks clear.
5. Run focused Node, complete Node, frozen-source integrity and exact-head GitHub Actions (including relevant local Workerd/D1 and browser regressions). A passing synthetic test is not an authenticated D1 report.

## Task 3 — review/merge
1. PR explicitly states M09 issue, dependency, file ownership, RED/GREEN proof and remaining M03/M04 integration blocks.
2. Verify six source-count checks and unchanged protected paths in PR diff.
3. Review and merge only after all required exact-head workflows pass. Verify merge and file presence on main; update issue #431 with evidence.

**Rollback:** revert two M09 code/test edits and the two docs. No D1, schema, data or finance rollback.
