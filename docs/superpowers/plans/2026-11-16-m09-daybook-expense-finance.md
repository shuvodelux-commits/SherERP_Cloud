# M09 Day Book Expense & Finance — implementation plan (Superpowers TDD)

> Follow superpowers:test-driven-development and superpowers:verification-before-completion. GitHub is the coding and CI source of truth; no local PC needed.

**Goal:** Reproduce original Expense + Business Finance Day Book display money and metadata without posting any transaction.

**Architecture:** pure `projectDayBookExpenseFinanceRows({expenses,financeTransactions},isAdmin=false,includeDeleted=false)`, complete preauthorized normalized snapshots; original Finance type table drives cash direction, Finance opening types stay cash-neutral, cancelled/deleted expenses cash-neutral. No D1 or public API. See source-anchored spec `docs/superpowers/specs/2026-11-16-m09-daybook-expense-finance-design.md`.

## Task 1 — Test first / original GAS oracle
- [ ] Create spec and this plan in new M09 GitHub branch from `main`.
- [ ] Add `tests/m09-daybook-expense-finance.test.mjs` executing exact pinned `DayBook.gs` Expense+Finance segments and `FinanceModule.gs` type lookup in `node:vm`. Compare complete object shapes/key order and original navigation.
- [ ] Cases: live Cash/Bank/Mobile/unsupported expenses, cancelled/deleted expenses, all six cash-bearing finance transaction types, all three historical opening types, unknown type, metadata/finance reference, date fallback, admin deletion, mutations/unsafe money/date and public RPC closure.
- [ ] Test-only commit, draft PR, actual full Node GitHub Actions RED captured at test-only SHA (must fail for missing projector, no unrelated oracle/test failures).

## Task 2 — Minimal GREEN implementation
- [ ] Add `src/modules/daybook-expense-finance.js` only AFTER verified RED. Preserve exact source financial classification; no touching M08/Party/Cash Book writers.
- [ ] Validate complete own-data arrays, IDs/amount/date timestamps and actor flags. Duplicate IDs are refused, not guessed; copying records prevents mutation.
- [ ] Wait for exact SHA GitHub full Node/source build result and independent M01/Workerd checks; fix regressions first (if needed with focused new failing tests), do not overclaim real D1 accounting.

## Task 3 — Review and follow-up
- [ ] Update draft PR with RED/GREEN URLs/counts, file/SQL/RPC/source impact, rollback and currently open PR #381; re-check main/mergeability. Never auto-merge.
- [ ] Next M09 source projections: Bank Transfer and Stock Adjustment; only then authorized *complete* D1 Day Book source adapter and reconciliation with Cash/Bank, M04 roles, M07 corrections, M08 Party gross ledgers, M10 migration tests and M11 approved production cutover.

## Shared M07 Workerd D1 check unblock (2026-11-16)

Historical M03 D1 integration failed solely on `unpaid original purchase Supplier Credit correction never creates Cash entry` (485/486 passing): an M07 synthetic test supplied a blank **input** payment method despite the purchase writer requiring `Cash` or `Bank`. The original business rule remains that **zero paid amount persists no tender method and posts no Cash/Bank entry**. The independent source-compatible repair is owner-merged [#390](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/390) (20/20 checks at fix SHA `5a586e75d86cd40bcef3da739179ad70ace5f46d`). This branch now merges `main@0e4dbd5c17f3e33077e1b81f7799a8d42c29758e`, with the M07 fixture fix and all four original M09 files preserved. No M09 projector/financial writer was changed for this CI issue. **Verify fresh exact-head M03 Workerd/D1 and all PR checks before treating this PR as GREEN.**
