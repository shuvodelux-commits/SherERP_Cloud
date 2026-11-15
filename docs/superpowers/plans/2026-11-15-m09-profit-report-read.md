# M09 Profit Report — Superpowers RED → GREEN plan

**Date:** 2026-11-15. **Branch:** `m09/profit-report-read-20261115`. **Spec:** `docs/superpowers/specs/2026-11-15-m09-profit-report-read-design.md`. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Task 1 — create failing original-source tests

1. Create `tests/m09-profit-report-read.test.mjs` and execute exact `computeProfit_`, `getProfitReport`, range/group helpers from frozen `Reports.gs`; native `economicReturnLineAmount_`, `roundMoney_`, duplicate Sales Invoice assertion and number validation from `Utils.gs` in Node VM. Stub original `CacheService` to no cached results, simulate `getAllRows_` and `activeRows_` from source-shaped snapshot and independently calculated `computeSettlementDiscountProfit_` fixture.
2. Test complete report output, per-invoice discount factor, original-date return allocation, already-net COGS, vendor sourcing, expense cancellations, settlement discount impact, margins/loss-makers, bundle cost coverage, zero/missing cost evidence, top 15, date range normalization, duplicate selected Invoice IDs and malformed/unsafe inputs. Avoid fragile hardcoded assertions except deterministically evaluated values.
3. Commit tests **before production module**, open draft PR and record real GitHub Actions expected missing-module RED. If native test harness has an error, fix test-only then observe meaningful RED.

## Task 2 — smallest pure GREEN module

4. Create `src/modules/profit-report-read.js` exporting `projectProfitReport(snapshot,filters,today)`. Reuse `normalizeReportRange`, `dateInReportRange`. Require arrays and explicit trusted settlement summary. Match original source report shape and rounding precisely; do not add SQL, public RPC or new dependencies.
5. Commit and review exact-head GitHub CI. Fix source drift; run full Node tests, original 84-source-file manifest, original frontend 36 includes, existing local Workerd/D1, Party/login and browser checks. Clearly distinguish source-VM unit evidence from live authorized D1 Profit Report.
6. PR diff should contain only spec/plan/tests/module; record source/RPC/SQL/UI impact (none), exact SHA RED/GREEN job links, rollback and outstanding M03–M08 gates. Do not auto-merge while draft.

**Rollback:** revert four new files; no D1/data migration.
