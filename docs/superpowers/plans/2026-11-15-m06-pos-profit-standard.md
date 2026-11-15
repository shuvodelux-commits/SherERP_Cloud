# M06 — Standard-product POS profit preview source parity (Superpowers TDD)

**Source:** immutable Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; frozen `legacy/source/Sales.gs::estimatePosInvoiceProfit_` and `StockLots.gs`, `Bundles.gs::bundleProductType_`. GitHub main after merged #93. Owner-approved architecture: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`.

## Goal

Add a pure **internal** estimate of POS invoice profit for **Standard** product lines, using the already-merged M05 source-exact FIFO and vendor net-stock planning helpers. Preserve the original `Sales.gs` totals, weighted sale price behavior, mixed-supplier FIFO costs, shortage fallback, vendor cost, price modes, discount cap, margin, and `costComplete` flag. A preview is never an authoritative booked profit/journal/cost and never mutates stock.

Original `previewPosInvoiceProfit(token,payload)` requires both authenticated `pos.view` and an independent `canViewInvoiceProfit_` permission. The pure port **must not be exposed in RPC, Worker or UI**, and its future caller must enforce these rights *before loading sensitive cost/lot rows*. This pure function itself does not accept user auth flags.

## Test-first acceptance

1. **RED**: new `tests/fixtures/m06-pos-profit-source-oracle.mjs` extracts and executes frozen source functions (using Acorn AST and isolated Node VM), with explicit products/stock-lots and original Asia/Dhaka date handling; new `tests/m06-pos-profit.test.mjs` compares source vs missing module for FIFO across multiple suppliers, auto/manual/fixed pricing, price ladder, full/partial vendor shortage and net stock, fallback cost, costComplete, discount/zero total, duplicate/missing/bad input and immutability. Demonstrate GitHub CI RED failure for missing module.
2. **GREEN**: implement minimal `src/modules/pos-profit-standard.js` exporting `estimateStandardPosInvoiceProfit(payload,{productsById,stockLots})`, reusing `planStockConsumption_`, `planSaleVendorConsumption_`, `computePlanSellingPrice_`, `roundMoney_` and `isValidNonNegativeNumber_` from merged M05; no parallel FIFO calculator. Explicitly reject Bundle products and any unknown source product type until native bundle component-demand plans are integrated; original source handles bundles, but pretending to support them here would leak wrong COGS.
3. **VERIFY**: 84 pinned files unchanged, full Node, focused source-oracle, existing local real Workerd/D1 CI regressions, M04 auth D1, original frontend and Chromium tests. Document strict Standard-only subset and related source discrepancy (Deleted lots eligibility in M05).

## File ownership / release gates

Only four additive files: plan, oracle, tests and the pure module. No src/rpc, DB migrations, production schema or Money/Stock/Party mutations, no UI redesign, no public Worker binding, no external data. Source is **behaviorally adapted** with explicit read inputs, not copied byte-for-byte. Rollback: revert PR (zero production data). M04 cost permissions + M03 trusted tenant-scoped lot reads, M05 accepted lot Deleted eligibility and full bundles, M08 settlement and M06 D1 posting gates remain blocked. M06 NOT complete.
