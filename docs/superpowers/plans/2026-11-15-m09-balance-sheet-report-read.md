# M09 Balance Sheet Report — Superpowers test-first implementation plan

**Date:** 2026-11-15. **Branch:** `m09/balance-sheet-report-read-20261115` from main after merged #199. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Spec:** `docs/superpowers/specs/2026-11-15-m09-balance-sheet-report-read-design.md`.

## Task 1 — RED original-source regression contract

1. New `tests/m09-balance-sheet-report-read.test.mjs`: execute exact native `getBalanceSheetReport`, `getInventoryValueAtCost_`, `getCashBalance_`, `sanitizeAccountType_`, `roundMoney_` under `node:vm`, source-shaped active Cash Book/all Stock Lots/all Bank Accounts and source-era finance summary injection, no real D1 or leaked CacheService.
2. Exact JSON-response parity tests cover Cash, Bank vs Mobile Banking, negative/zero stock lots, no date range, nonbalancing partial balance sheet, ignored inactive bank account, original source rounding only for cash, no mutation and strict trust failures.
3. Commit tests before module, open draft PR, **observe expected missing-module RED GitHub Actions**; correct any native oracle fixture failure before implementing.
4. Inventory note: the original Balance Sheet `getInventoryValueAtCost_` sums *all* lot quantities, unlike `getStockReport`. Do not combine or silently normalize these algorithms.

## Task 2 — GREEN minimal adapter

1. New `src/modules/balance-sheet-report-read.js`, export `projectBalanceSheetReport(snapshot,asOf)`. Use no new dependencies or caches; validate trusted arrays and M08 summary; compute exact source amounts in one function.
2. Run exact-head CI: full Node suite, 84 frozen source verifier, original frontend 36 includes, available local Workerd/D1 and Chromium desktop/mobile/A4 checks. Correct any parity differences with smallest code or fixture change; note evidence.
3. Diff should contain only four new files; do not add M04 auth, RPC, D1 schema, generic trial balance, new finance posting or UI.

## Task 3 — review

1. Update draft PR with source-pinned inventory, test-first RED/GREEN jobs, exact-head statuses, upstream M05/M08/M04 gates and rollback.
2. Recheck latest main and merge conflict; leave PR for owner review. **Never auto-merge this PR**.

**Rollback:** revert four new files; no data changes.
