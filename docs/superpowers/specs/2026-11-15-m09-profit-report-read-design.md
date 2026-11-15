# M09 Profit Report — frozen-source read model design

**Date:** 2026-11-15. **Authority:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Reports.gs::computeProfit_` + `getProfitReport`, `Utils.gs` and original `reports.html`. Continues after merged M09 Cash & Bank Report PR #192.

## Scope and design choice

Original Profit Report is a read-only calculation across Sales, Sale Items, active Sales Return Items, net-of-return consumed SALE_ITEM_LOTS, active VENDOR_SOURCING, active Expenses and SALE_BUNDLE_COMPONENTS. It also includes **Customer settlement discount given** and **Supplier settlement discount received** supplied from the original SettlementDiscount module. Do not create a parallel financial ledger, FIFO planner, settlement writer, public RPC or database reader here.

Selected: a **pure internal** `projectProfitReport(snapshot,filters,today)` that reproduces the *complete* frozen response from trusted source-shaped records and an **independently reconciled** `snapshot.settlementDiscount` summary. The caller is responsible for authenticated `reports:view`, reading source-equivalent active/raw datasets from M05/M07/M08, and computing settlement discount from approved Customer/Supplier ledger readers for the selected range. No derived default zero is acceptable: even empty book fixtures explicitly supply three finite zero fields.

## Contract

`snapshot` own-data arrays:
- `allSales`: **all** source SALES rows (including deleted) for native selected-invoice duplicate detection; filter active and date range. Duplicate Invoice ID for a selected invoice must reject, including duplicate deleted/historical rows; do not silently certify ambiguous COGS.
- `saleItems` = all SALE_ITEMS rows; `lotConsumptions` = all SALE_ITEM_LOTS rows, where Quantity is **already net of returns**; never subtract returned COGS again.
- `saleReturnItems` = prefiltered `activeSalesReturnItems_()`, where both return header and child are active, without return-date filtering. Original-value versus `NetAfterInvoiceDiscount` discount basis must match `economicReturnLineAmount_`, and return reduces the **original invoice period**.
- `vendorSourcing` = active `VENDOR_SOURCING` rows (not lot-backed) with `Total Cost` when valid nonnegative, else Quantity × Unit Cost.
- `expenses` = active EXPENSES rows; exclude `Status === 'Cancelled'` and outside date range.
- `saleBundleComponents` = all `SALE_BUNDLE_COMPONENTS` snapshots; virtual bundle sale quantities resolve to physical component quantities for **cost coverage only**, not revenue or COGS recalculation. Saved sale-time bundle recipe matters, not a current catalog recipe.
- `settlementDiscount` = separately-authorized source-derived `{customerDiscountGiven,supplierDiscountReceived,netProfitImpact}` numbers, with `netProfitImpact` reconciled to the exact source `roundMoney_(supplierDiscountReceived - customerDiscountGiven)` rule. NEVER recompute or net unrelated Party roles.

`filters`, `today` use the merged `report-date-range.js` inclusive, reverse, default-current-month semantics. All relevant Sales/Expense Date columns must be normalized shop-local YYYY-MM-DD by the caller.

**Exact response** is original `{range,totals,coverage,byProduct,expenseByCategory,topProducts,lossMakers}` with source order: grossSales is **Grand Total** sum, revenue by product is discounted line total minus economic returns, COGS from net lot quantity × unit cost + active vendor sourced costs, grossProfit = netRevenue - cogs, netProfit = source-rounded (grossProfit - expenses + settlementDiscount.netProfitImpact), margin percentages 0 when netRevenue ≤ 0. Expense category and product groups retain source order/ties and sort by source fields. `coverage` counts invoices whose required **net physical quantities** lack complete cost evidence, missingSample max 10 in selected sale order; zero remaining product quantity is covered, invoice with no sale items is missing, and bundle component demand is added then virtual demand removed. Source's legacy field name `invoicesWithLotData` includes vendor cost evidence, despite misleading name.

## Safety & edge behavior

Require plain own-data rows/arrays, no Promise/getter/inherited row values, finite business money and physical quantities, and explicit unique original Sales Invoice IDs. No cached Profit result in this module (original CacheService materialization unsafe in Workers without invalidation and source-generation evidence). No source edits, UI redesign, RPC registration, D1 schema or production financial data change.

Test exact full native function bodies under Node VM with original GAS rows and deterministic settlements, with **no real D1** claim. Source parity is required for normal well-formed unique-ID evidence. Intentional corruption-only rejection for invalid inputs may differ from GAS tolerance. The source output includes a loss-maker sample, coverage and settlement impacts, so rejecting missing cost evidence outright would be **wrong**; report incomplete coverage explicitly instead.

## Deliverables and rollback

Only four new files: this spec, `docs/superpowers/plans/2026-11-15-m09-profit-report-read.md`, `tests/m09-profit-report-read.test.mjs`, `src/modules/profit-report-read.js`. Implement via Superpowers test-first verified **RED**, then minimal **GREEN**, then exact-head GitHub Actions source audit, Worker, existing local D1, Chromium desktop/mobile/A4, and PR with impact and rollback. Rollback = revert these four additions; no financial rows affected.

**Remaining gates:** source-authenticated Profit RPC integration, customer/supplier settlement D1 reader, FIFO and vendor sourcing read reconciliation, real D1 coverage fixtures, M04 reports:view and M07 reversal provenance. This PR is **not** permission to deploy a functioning ERP.
