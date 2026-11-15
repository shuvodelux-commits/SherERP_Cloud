# M09 Purchase Report — Superpowers TDD Execution Plan

**Date:** 2026-11-15  
**Source:** frozen `Reports.gs::getPurchaseReport`, `Utils.gs` from pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Design:** `docs/superpowers/specs/2026-11-15-m09-purchase-report-read-design.md`.  
**Branch:** `m09/purchase-report-read-projection-20261115` from approved `main` after merged #156.

## Task 1 — RED source-oracle tests

**New file:** `tests/m09-purchase-report-read.test.mjs`.

- [ ] Execute exact frozen `getPurchaseReport`, `reportRange_`, `inRange_`, `sortedByDesc_`, `roundMoney_` and `economicReturnLineAmount_` as native JS in isolated `node:vm`; provide inert GAS context with deterministic Date, permissions, `activeRows_` and precomputed supplier settlement evidence.
- [ ] Eight tests verify full grouped response including source rounding, positive due and paidLater, active parent/child return price basis, historical purchase/return date attribution, current-month/reverse/inclusive filters, stable top 15 suppliers, no input mutation and fail-closed invalid data.
- [ ] Separate corruption-case test for *selected duplicate Purchase IDs*: reject (original source overwrote silently); distinguish this intentional safety improvement from source equality assertions.
- [ ] Commit **tests before any production module**, create draft PR, inspect a real GitHub Actions failing run due to missing adapter (not syntax/fixture error).

## Task 2 — GREEN smallest internal module

**New file:** `src/modules/purchase-report-read.js`.

- [ ] Implement `projectPurchaseReport(snapshot,filters,today)` in plain ESM; reuse merged `report-date-range.js`, do not copy whole GAS source or invent SQL.
- [ ] Validate trusted active Purchase/Return arrays and required separately-authorized settlement values, accumulate results with exact GAS rounding/ordering/source labels, reject selected duplicate IDs.
- [ ] No RPC/public activation or changes to source, billing/Party, Cash/Bank, purchase posting, M07 return or M08 supplier settlement.
- [ ] Use exact-head CI to verify new source-oracle tests, full Node suite, pinned source manifest, original frontend build, existing D1/Workerd and browser/print safety workflows. Refactor only if tests indicate need.

## Task 3 — Review, evidence and rollback

- [ ] Inspect four-file PR diff and base-branch drift. PR body includes source SHA, RED/GREEN job links and test counts, impact matrix (no original UI/RPC/schema/auth/writers touched), intentional duplicate guard, remaining real D1/read-auth and financial reconciliation gates.
- [ ] Leave draft until final CI and independent owner review; no auto-merge.
- [ ] Roll back by reverting the four newly added files; no production-data rollback.

**Next M09 after review:** Live authenticated report/D1 read integration only when M03–M08 upstream source parity, SQL reconciliation and permissions are approved; otherwise advance independent stock/cash-bank report source fixtures.
