# Superpowers TDD — M09 internal Dashboard operational tiles composition

**Original authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, mirrored in `legacy/source/Dashboard.gs`, `FinanceModule.gs` and `Utils.gs`; governed by `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007. **Ownership:** M09 independent *read-only* internal projection; no M02/M03/M04/M08 shared-file ownership.

## Goal
Add `projectDashboardCoreTiles(snapshot)` to reuse **five existing merged pure projections** rather than implementing a second Dashboard accounting engine:
- `projectDashboardTodayNetSales` (return-aware today's invoice revenues);
- `projectDashboardDailyMovements` (collections, expenses and purchases);
- `projectDashboardGrossDues` (independent Customer AR and Supplier AP);
- `projectDashboardFinanceSummary` (independent signed Owner/Lender/Borrower relationships);
- `projectDashboardLowStockCount` (active Products stock threshold).

Return nine original source-shaped fields in source order: `todaySalesTotal`, `todayCollectionTotal`, `todayExpenseTotal`, `todayPurchaseTotal`, `dueReceivable`, `borrowerReceivable`, `supplierPayable`, `outstandingLoan`, `lowStockCount`. The original full `getDashboardStats` returns 11 fields, including `cashBalance` and `currencySymbol`. **DO NOT fabricate, default, or add those two**: Cash/Bank reconciliation and Settings currency authorized D1 reads are independent integration gates; M09 currency branch #256 is active.

## Preconditions and input contract
- Snapshot required own fields exactly: `today`, `todaySales`, `activeReturnItems`, `customerLedgerRows`, `expenseRows`, `purchaseRows`, `activeCustomers`, `activeSuppliers`, `activeProducts`, `activeTransactions`. Check plain object, exact keys, own data descriptors, arrays as arrays, and no forged actor/tenant/auth/cash/currency keys. Delegate per-row/date validation to existing tested projections. No fallback empty arrays for absent source groups: fail closed.
- Trusted future M03 reader *must* supply rows from one tenant/business, prefiltered as frozen `activeRows_` and already normalized to shop-local dates, including both Sales Return header and line active flags. Caller must **also** check Sales invoice uniqueness against the full active Sales collection, as `getDashboardStats` does, before passing the today subset; composing this pure projector does not establish that precondition.
- The M04 server gate `dashboard.view` remains mandatory **before** data reads. No public RPC in this PR; this projector must not accept token/permissions from the browser. No source-GAS modifications.
- Do not join same-name Customer/Supplier/Finance persons or net roles, and do not calculate new cash/bank activity from historical opening positions.

## TDD plan
1. Commit plan, then RED Node regression tests using an independent VM to run the **actual frozen** `getDashboardStats` and all its source helper bodies on prefiltered, synthetic source-shaped fixtures, compare the exact nine numeric fields (excluding the two unimplemented gates). The VM stubs *only external services* (token gate, sheet read, shop date, cash/currency and source all-Sales uniqueness preflight); it is NOT evidence of runtime authorization or D1 integration. Cross-check empty/realistic datasets, returns, settlement discounts, opening loans, low stock, same-name distinct Party roles and invalid snapshot.
2. Verify exact-head GitHub Foundation RED on missing module import; then implement a single minimal pure composer with no duplicate business arithmetic.
3. Verify exact-head Foundation and other CI, including M01 Chromium, M02/M03/M04 real local Workerd+D1 regression and Cloudflare PR safety (they are *not* a Dashboard D1 integration proof). Document RED/GREEN and CI in the draft PR.
4. Owner reviews and merges after all checks. No production/staging D1 write, migrations, public Worker RPC, Cloudflare preview data binding, UI redesign or finance posting. `PARALLEL-MODULE-READY=false` until source reconciliation and backend gates.

**Files:** only `src/modules/dashboard-core-tiles-read.js`, `tests/m09-dashboard-core-tiles.test.mjs`, and this plan. No shared `src/db`, `src/rpc`, `src/index.js`, source `.gs`, `frontend/raw`, `migrations`, `wrangler` or GitHub workflow edits. **Rollback:** revert this pure PR, no schema/data recovery.
