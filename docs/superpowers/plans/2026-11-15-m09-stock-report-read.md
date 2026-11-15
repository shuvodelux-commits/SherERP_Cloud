# M09 Stock Report — Superpowers RED/GREEN Execution Plan

**Date:** 2026-11-15. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Reports.gs::getStockReport`, original `reports.html`. **Spec:** `docs/superpowers/specs/2026-11-15-m09-stock-report-read-design.md`.

## Task 1 — RED before implementation

**Create `tests/m09-stock-report-read.test.mjs`.**
1. Extract unmodified `getStockReport` and `sortedByDesc_` bodies from frozen `Reports.gs`; execute through `node:vm` with deterministic `requirePermission_('reports','view')`, source `activeRows_('PRODUCTS')`, `getAllRows_('STOCK_LOTS')` and `ok_`.
2. Assert exact full original response for multi-lot FIFO-cost valuation, active/inactive Product rows, no date filter, negative and zero stock, orphan/nonpositive lots, mismatches, category grouping and source sort/stable ties.
3. Add fail-closed invalid row/Promise/accessor/nonfinite and duplicate product-ID corruption tests, explicitly noting the latter is safer than source behavior.
4. Commit tests **without production code**, open draft PR and capture exact GitHub Actions RED failure due to expected missing module.

## Task 2 — Minimal GREEN

**Create `src/modules/stock-report-read.js`.**
1. Export `projectStockReport(snapshot)` from plain ESM, requiring own-data `activeProducts` and `stockLots` arrays of trusted source-shaped active Products/all Lots.
2. Follow original arithmetic exactly: lot-level positive remaining quantity, additive product lot value/quantity, selling retail from Current Stock, status/active filters, out-vs-low count, lowStock detail, byCategory and sorted products. No rounding/hidden state.
3. Fail closed on duplicate active Product IDs and invalid trusted snapshot; no D1/Worker/RPC/finance/stock mutation.
4. Observe exact-head GREEN with full Node suite, 84 pinned frozen files, 36 original frontend includes, browser/print and existing local D1 CI checks. If tests fail, fix minimal code, rerun and document exact commits.

## Task 3 — Review

- Inspect 4-file diff and current `main` base drift; PR description records source oracle fixtures, RED/GREEN job links/counts, no shared source/RPC/SQL impact, upstream D1 auth/stock-FIFO reconciliation gates, and rollback.
- Leave draft for independent owner review/merge; do not make public Stock Report active or claim full M09 completed.

**Rollback:** revert four newly added files; no migrations or record mutations.
