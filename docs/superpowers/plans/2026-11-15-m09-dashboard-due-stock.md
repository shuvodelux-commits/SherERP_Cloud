# M09 Dashboard Role Balances and Low Stock — Superpowers TDD Plan

**Date:** 2026-11-15
**Spec:** `docs/superpowers/specs/2026-11-15-m09-dashboard-due-stock-design.md`
**Pinned source:** `Dashboard.gs::getDashboardStats`, `Utils.gs::roundMoney_`
**Prior merged PRs:** #125 (date windows), #133 (four daily activity cards)

## Task 1 — RED original-source oracle tests
**New:** `tests/m09-dashboard-due-stock.test.mjs`.
- [ ] Read exact original `getDashboardStats` function from frozen source, native `roundMoney_` helper, execute in isolated `node:vm` with zero stubs for unrelated fields and true active-row fixture groups.
- [ ] Compare `dueReceivable`, `supplierPayable`, and `lowStockCount` for multi-role gross separation, negative balances, decimal rounding, inactive stock, numeric string conversions, zero thresholds, undefined values, and empty arrays.
- [ ] Reject Promise/non-array rows, invalid row types, accessors and malformed amounts, without mutating source snapshot.
- [ ] Commit tests only, open draft PR, capture GitHub Actions RED expected `M09 due/stock dashboard adapter not implemented`.

## Task 2 — Minimal GREEN
**New:** `src/modules/dashboard-due-stock.js`.
- [ ] Export `projectDashboardDueStock(snapshot)` with strict, simple, trusted row shape.
- [ ] Mirror exact source `Math.max(0,Number(v)||0)`, `roundMoney_`, `Status === 'Inactive'` and numeric `<=` threshold; don't pre-round each row or net roles.
- [ ] Run exact-head Actions: full Node suite, pinned source verifier, frontend build, CI browser/print and existing D1 jobs. Observe rather than assume results.
- [ ] Keep separate authorized D1 query/source mapping for later work.

## Task 3 — Review / release
- [ ] Inspect four-file diff and CI; provide RED/GREEN evidence in PR, files, source SHA, contracts, no changes to financial posting or SQL.
- [ ] Leave draft pending owner review, no automatic merge or customer-facing Dashboard activation.

**Rollback:** revert isolated module, test, spec and plan; no data migration or record mutation. **Out of scope:** Finance Persons/Loans, cash drawer, schema, report SQL, UI, Party netting.
