# M09 Complete Dashboard Read-Response Composition — Design (2026-11-15)

**Authority:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Dashboard.gs::getDashboardStats`, `Utils.gs::roundMoney_`, and `dashboard.html::dashLoad`.
**Prerequisites already merged:** #125 report date windows, #133 daily cards and #139 separate gross due / low-stock cards.

## Scope / output

The original Dashboard RPC returns 11 fields in one object: `todaySalesTotal`, `todayCollectionTotal`, `todayExpenseTotal`, `todayPurchaseTotal`, `dueReceivable`, `borrowerReceivable`, `supplierPayable`, `outstandingLoan`, `cashBalance`, `lowStockCount`, `currencySymbol`. The browser displays the ten metrics without a redesign. In this independent phase, produce **only** that read response shape using source-tested pure projections, without registering `getDashboardStats` or connecting the D1 read authorization boundary.

## Options considered

1. **Activate the entire RPC and SQL queries now:** blocked on approved M03/M04 auth, source-faithful M05/M07 stock/sales, M08 Finance/Cash/ledger read parity, and active-return child filtering.
2. **Recompute loan and cash balances inside M09:** rejected; would duplicate owner M08 calculation and risk misleading or combined seven-role balances.
3. **Selected:** compose existing pure M09 calculations with explicitly supplied, already-trusted Finance and Cash values from their *future* independently authorized read models. Reject missing, pending or non-finite externally sourced values. No hidden zero fallback.

## Input / behavior

`projectDashboardStats(snapshot, today)`:
- `today`: explicit trusted shop-local YYYY-MM-DD (validated by existing M09 module).
- `snapshot`: own-data plain object with already-authorized, already-active arrays `sales`, `salesReturnItems`, `customerLedger`, `expenses`, `purchases`, `customers`, `suppliers`, `products`. They preserve original column headings. A future D1 caller must filter both active returns **and their parent return headers** and ensure selected invoice IDs are unique.
- `financeSummary`: own-data plain object with **two existing source-like numeric fields** `borrowerReceivable` and `outstandingLoan`. They must be finite JS numbers derived by an authorized Finance read path; do NOT derive these from Customer/Supplier due or attempt to net Party roles.
- `cashBalance`: required finite JS number from a separately verified cash book reader; cannot silently substitute zero when reader unavailable. Negative cash is preserved.
- `currencySymbol`: required string, may be blank and may contain Bangla Unicode; used as exact source response value. Not HTML-interpolated in this module.

Output: exactly the 11 original keys, original order and native numeric types. Reuse `projectDashboardDailyActivity` and `projectDashboardDueStock` by imports instead of copying accounting formulas. No writes/mutation, no third-party dependencies, no on-demand network/D1 access, no user-supplied auth tokens/SQL, no fallback mock balances. Preserve native `roundMoney_` behavior from the two prior modules; do **not** round Finance/Cash values in the compositor (native `getDashboardStats` forwards them unchanged).

## Tests / safety

- RED: new test file executes original frozen `getDashboardStats` + helper bodies in an isolated Node VM, feeding the same fixture/finance/cash values through source stubs. Assert exact full-object parity, not just keys.
- Include returns after invoice discount, backdated invoice business date, active role debt separation for same identity, negative cash, non-cash legacy discount excluded from collection, blank currency and low-stock boundary; ensure changes to Finance/Cash inputs pass through unchanged.
- Fail closed if any requested input missing, inaccessible, getter, Promise, invalid input array/row, nonfinite finance/cash metric, or unnormalized date. Explicit zero valid only when trusted caller supplies zero.
- Validate source/Worker/build/browser/real-local-D1 CI on exact head; distinguish tested pure output from unimplemented live worker-D1/auth/complete accounting reconciliation.
- No modifications to original source, SQL schema, D1, auth, Worker RPC, Cloudflare bindings, frontend layout, finance or sales posting. Pure isolated new file/test/docs only; revert four files to roll back.
