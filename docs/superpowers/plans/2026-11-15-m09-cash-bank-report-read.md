# M09 Cash & Bank Report — Superpowers TDD plan

**Date:** 2026-11-15. **Branch:** `m09/cash-bank-report-read-20261115`. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `Reports.gs::getCashBankReport`.

## Step 1 — RED source oracle
- [ ] New `tests/m09-cash-bank-report-read.test.mjs`. Load native function bodies for `roundMoney_`, `reportRange_`, `inRange_`, `tsDateOnly_`, `sortedByDesc_`, `getCashBankReport` from frozen source. Run under Node VM with controlled `activeRows_('CASH_BOOK')`, `getAllRows_('BANK_BOOK'/'BANK_ACCOUNTS')`, shop-local date, permission assertion and ok/fail stubs.
- [ ] Test exact entire `range,cash,banks,bankTotals,combined` result including pre-range openings, timestamp normalization, same-day ID ordering, reversal retention, stored Bank opening vs opening ledger row, inactive accounts, separate Bank IDs, grouped cash types, rounding, empty periods and missing data.
- [ ] Test errors for Promise arrays, accessors, malformed dates/amounts, duplicate active bank IDs and nonmutation.
- [ ] Commit tests only; open draft PR; inspect exact-head GitHub Actions and capture missing-module failure as RED. Repair fixture errors before implementation if needed.

## Step 2 — GREEN read model
- [ ] New `src/modules/cash-bank-report-read.js`: minimal pure `projectCashBankReport(snapshot,filters,today)` using shared `normalizeReportRange`; preserve GAS `tsDateOnly_`, row-sort, reversal and incremental `roundMoney_` behavior. Strict trust input check and no app state writes.
- [ ] Run GitHub exact-head Node source-oracle suite, 84 frozen file verifier, 36 frontend includes, remaining source/Worker, local D1 and Chromium CI. Fix drift only with smallest delta; record GREEN job SHA/count.

## Step 3 — Review/hand-off
- [ ] Inspect diff is only four new files, note base drift and no shared M08 or M04 ownership conflicts.
- [ ] PR body includes authoritative source/version, RED/GREEN links, contracts and safety gates. Draft for owner merge, no auto-merge or production activation.

**Rollback:** revert the four isolated files. **Remaining M09:** Profit/Balance Sheet parity and authorized real-D1 report bridge once M03–M08 approved.
