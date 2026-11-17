# M09 historical Sales invoice ambiguity — RED→GREEN plan

**Goal:** Fail closed on original Sales invoice IDs duplicated anywhere in history whenever a matching active invoice exists, including deleted-row and whitespace aliases.

**Source:** pinned frozen `Utils.gs::assertUniqueSalesInvoiceIds_` and `DeleteEngine.gs::isDeleted_`. **Base:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`; **issue:** #431.

## Ownership
Only four M09 paths: `src/modules/m09-sales-return-report-lineage-audit.js`, `tests/m09-sales-return-report-lineage-audit.test.mjs`, this plan, and `docs/superpowers/specs/2026-11-17-m09-historical-sales-invoice-ambiguity-design.md`.
No M03-owned database/RPC/Worker/posting, schema changes, frozen GAS edits, source IDs, original UI, or financial exports.

## Task 1 — RED
1. Add frozen original-GAS oracle extraction to M09 Sales Return test suite (the original duplicate ID helpers and deletion check, executed in `node:vm`).
2. Add five regression tests for active+deleted aliases, whitespace aliases, normalized active duplicates, deleted-only duplicates, combined case, redacted issues and non-mutation.
3. Commit spec, plan and tests **before production edit**.
4. Verify focused RED at exact test-only commit; failures must be the new ambiguity conditions only. Save GitHub Actions or isolated exact-commit test logs.

## Task 2 — GREEN
1. In `auditM09SalesReturnLineage`, track full historical normalized Invoice ID counts as well as active normalized counts, while retaining raw IDs for parent/child relationships.
2. Preserve existing `DUPLICATE_ACTIVE_SALE_INVOICE` for active normalized collision; add `AMBIGUOUS_HISTORICAL_SALE_INVOICE_ID` only when one active ID duplicates a deleted historical source ID.
3. Never return original IDs or amounts; never infer alias resolution. Keep `ready:false` invariant.
4. Verify focused suite; complete `npm test`; source manifest checksum; all exact-head GitHub Actions; unchanged M09-only file diff.

## Task 3 — review / merge
1. Create one scoped M09 PR to `main`, with issue #431, ownership, depend-on #522, RED/GREEN proof, exact head SHA and rollback.
2. Merge only with complete required CI and approved reviews; no bypass or rebase merely for moving main.
3. Verify new code/test on main; update issue #431.

**Rollback:** revert the four M09 paths. No historical source data, migration, customer or financial writes.
