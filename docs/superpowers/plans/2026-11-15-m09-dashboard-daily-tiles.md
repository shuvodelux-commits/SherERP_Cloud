# Superpowers TDD — M09 Dashboard daily operational totals

**Workstream:** M09 read-only source-parity preparation; M08 and real financial posting remain blocked.  
**Frozen authority:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Dashboard.gs::dashboardTodayCollection_/dashboardTodayExpense_/dashboardTodayPurchase_`, `legacy/source/Utils.gs::roundMoney_`.
**File owner:** M09 independent `src/modules/dashboard-daily-read.js`, its test and plan. Avoid shared `src/db/**`, SQL migrations, `src/rpc/**` and M04 auth code.

## Objective and scope
Extract only three source-faithful calculations from the Dashboard's operational tile path: customer money collected today, noncancelled expenses today, and purchase header amounts today. They are **not** full `getDashboardStats` and cannot replace gross Party account ledger, net sales, inventory, finance or cash balance.

The caller supplies trusted original header-shaped arrays already selected via source `activeRows_` semantics and dates already normalized to shop-local `YYYY-MM-DD`. Do not infer shop timezone from timestamps, auto-query D1, dynamically select sheets or accept request-derived permissions. Keep distinct cash customer payment value (not settlement discount) and the legacy Payment Amount fallback formula. No reclassification of finance/owner/vendor/loan transfers.

## Test-first acceptance and implementation
1. **RED:** Add `tests/m09-dashboard-daily-read.test.mjs` before implementation. Execute the exact frozen helper function bodies in an isolated Node VM to form an independent source oracle for diverse sanitized row fixtures, with only the explicitly trusted date-only `safeDateOnly_` contract and source `roundMoney_`. Assert output-key parity, empty rows, Payment Amount present/zero/blank fallback, negative clamp, cancellation, source active-row selection, dates and precision.
2. Add negative tests for malformed caller context, accessor rows, unnormalized timestamps/dates and Promise values. These are fail-closed internal hardening beyond original GAS.
3. Verify GitHub Foundation fails exactly on missing `dashboard-daily-read.js`, then implement the smallest pure function `projectDashboardDailyMovements({today,todaySales,customerLedgerRows,expenseRows,purchaseRows})`.
4. Do not add unreviewed D1 tables just to claim a real D1 report. Existing local D1 tests remain regression gates; source-data integration comes only after M05/M07/M08 reconciliation and M04 trusted authority.
5. Exact-head full CI, original source manifest, unchanged HTML/frontend and no-secret Cloudflare PR preview. Link RED/GREEN evidence in draft PR and leave owner review/merge.
6. **No public RPC, schema, source GAS, frontend changes, business writes, remote D1 imports, or Party gross-account netting. PARALLEL-MODULE-READY remains false.**

Rollback: revert this standalone pure M09 module and test/plan.
