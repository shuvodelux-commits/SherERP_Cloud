# Superpowers TDD: M09 Dashboard Today Sales net revenue parity

**Frozen source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/Dashboard.gs::dashboardTodayNetSales_`, `getDashboardStats`; `legacy/source/Utils.gs::economicReturnLineAmount_`, `roundMoney_`. Source-manifest verification remains mandatory.

**Goal:** One internal, pure, read-only helper `projectDashboardTodayNetSales({today,todaySales,activeReturnItems})` for the `todaySalesTotal` Dashboard tile. Follow the original logic: sum included invoice `Grand Total`; deduct each active return line belonging to an included invoice (even when return occurred later), applying the original subtotal/grand-total discount factor only for legacy rows that lack the `NetAfterInvoiceDiscount` pricing basis; round **once at the end** with source `roundMoney_`.

**Source input ownership:** Later authenticated M03 repository integration owns filtering active original `SALES` by shop-local date, validating invoice ID uniqueness against the *full* source Sales collection, and filtering Sales Return child rows by active header and child flags. This pure helper validates its own supplied invoice subset, but is **not** authorization or complete source aggregation. No `reports.view` grant here; future `dashboard.view` must be checked on the server.

**Security/data contract:** Strict own-data snapshot and plain source rows only. Reject Promise/accessor/prototype-tainted rows, invalid `today`, duplicate/missing invoice IDs, mismatched/noncanonical Sales dates, invalid amount objects and unsupported nested values. Preserve source behavior for missing/empty, nonnumeric *scalar* numeric fields (treated as zero), over-return negative totals, historical discounted return lines, and unrelated return lines (ignored). Do not infer permissions from browser or Party roles.

**File owner / impact:** only `src/modules/dashboard-today-sales-read.js`, `tests/m09-dashboard-today-sales.test.mjs`, this plan. No modifications to `src/db`, migrations, `src/rpc`, Worker, source GAS, frontend, cash/bank, Party/finance, tenant identity or Cloudflare preview. No D1 writes/reads in this pure slice. The real Workerd/D1 CI is a regression gate, not evidence that Today Sales is wired to D1.

## RED→GREEN
1. Commit this plan and executable Node regression tests which load **actual frozen helper bodies** in an independent VM; before implementation GitHub Foundation must fail because the new module is missing.
2. GREEN: implement one small pure function that reads trusted row arrays, maps invoices by stable unique ID, applies exactly the frozen `economicReturnLineAmount_` and `roundMoney_` semantics. No duplicate accounting engine or refactor of Dashboard/Reports.
3. Preserve date attribution: an active return dated after `today` still reduces the original invoice's Today Sales. A return for another invoice does not count. Standalone mismatched/stale source inputs fail closed.
4. Exact-head Foundation/source QA, M01 Chromium and M03/M04 real D1 regression CI must pass. Record evidence and leave draft PR for owner review. `PARALLEL-MODULE-READY=false`; M05–M08 postings/account reconciliation and production auth/cutover remain separately blocked.

Rollback: revert pure module, test and plan; no schema/data migration.
