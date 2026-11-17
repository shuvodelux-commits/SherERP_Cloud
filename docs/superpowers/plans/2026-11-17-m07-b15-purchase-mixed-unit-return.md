# M07-B15 — Historical Mixed-Unit Purchase Return Original-Lot Preflight

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development; test first, observe actual RED, smallest GREEN, full exact-head CI before merge.

**Goal:** Review a historical mixed-unit Purchase Return against the already trusted M05 purchase-time unit/price snapshots and the precise original purchase-lot stock remaining, without switching to current unit conversions or to unrelated purchase lots.

**Architecture:** A small M07-only pure `planHistoricalMixedUnitPurchaseReturn(source,intent)` uses the merged `auditMultiUnitPurchaseSnapshot` to enforce original unit/price conservation and `planPurchaseReturnLots` for purchase-scoped FIFO. It validates a single explicitly imported original M05 purchase line and source purchase lots, rejects legacy fallback, and projects exactly the stock-lot reductions (without unit cost, Supplier credit or refund amount). No new SQL/RPC, bank/cash, product mutation or duplication of M03 atomic posting code.

**Tech:** Node ESM `node:test`, GitHub Actions full suite, current merged `src/modules/m05-multi-unit-purchase-preflight.js`, `m05-purchase-unit-snapshot-conservation.js`, M07 `purchase-return-lot-plan.js`. **Sources:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseReturn.gs`, `StockLots.gs::planPurchaseReturnLotReduction_`; optional approved unit conversion `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Coordination / ownership

- **Owner/issue:** M07 issue #314, board #456. Start `main@7c81dca09f975fbda37586eb50c2763c7f8506df`. Depends on merged M05 multi-unit purchase modules, merged M07 source-lot planner. Independent of B14 PR #507; files do not overlap.
- **Exact paths:** `docs/superpowers/plans/2026-11-17-m07-b15-purchase-mixed-unit-return.md`, `tests/m07-historical-purchase-mixed-unit-return.test.mjs`, GREEN-only `src/modules/m07-historical-purchase-mixed-unit-return.js`.
- **No shared ownership:** no `src/db/**`, numbered D1 schema/migrations, `src/rpc/**`, `src/index.js`, shared posting/reversal/cash policy, `wrangler*`, M05 source code, M08 Party accounts, M01 UI/printing, production/staging DB or original GAS. M03 remains single SQL-atomic integrator.
- **Read/write:** trusted source-shaped plain JS input only; no D1 writes, remote data, auth, inventory reservation or production permission.

## Exact contract

`source` is `{tenantId,purchaseId,productId,supplierId,sourceHash,originalLineTotalPaisa,alreadyReturnedBaseQty,line,lots}`; `line` is a *persisted original* merged M05 `prepareMultiUnitPurchasePreflight` line, including `qty`, `price`, `unit:{stockUnit,lineTotal,unitSnapshot,pricingSnapshot}`. This is not the current product/unit catalog. `lots` contains immutable original purchase-owned rows plus optional other-purchase stock rows for anti-borrow checks, each with `Lot ID`, `Purchase ID`, `Product ID`, `Original Quantity`, `Remaining Quantity`, `Purchase Date`, `Purchase Price`, `_rowIndex`, optional `Supplier ID`. Original owned lot quantities must sum exactly to original line base quantity. Original source quantity and price must reconcile against M05 audit and original line money evidence; no retrofit of today's unit factors.

`intent` is exactly `{tenantId,purchaseId,productId,returnId,unitBreakdown:[{conversionId,qty},...]}`. Each requested component is from the historical original unit snapshot with positive integer qty no greater than its original component qty. Compute requested base qty only from historical saved factors; enforce `requestedBaseQty<=line.qty-alreadyReturnedBaseQty`. Duplicate/unknown conversion, foreign tenant/product/purchase or caller-supplied unit factor/price/lot/actor/refund is rejected. Physical source lots from the same purchase **only** are selected using the original `planPurchaseReturnLots` FIFO. Reject unproven legacy fallback and insufficient original purchase-lot stock. No borrowing from another purchase even with older FIFO date or same physical SKU.

Output: `{status:'PLAN_ONLY',data:{tenantId,purchaseId,productId,returnId,requestedBaseQty,historicalUnits,sourcePurchaseLots:[{lotId,sourceRowIndex,baseQty,remainingAfter}],readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false}}` with all nested rows frozen. Decline the whole request if original remaining physical stock is insufficient. Throw `NEEDS_REVIEW` for mismatched original snapshot, missing/duplicate lot provenance and malformed trusted sources. Do **not** calculate original discounted invoice financial refund, cash collected, Supplier credit or supplier Party net. Do not reinterpret existing historical returns' unit breakdown unless source includes audited evidence.

## Superpowers TDD

- [ ] Plan/branch from latest main and test-only commit; verify real GitHub RED failure, not imagined.
- [ ] Test sale-time 1 Bag+2 Box+5 Pcs=145 Pcs and 730 BDT original purchase-line, returning 1 Box+5 Pcs=25 Pcs from two original purchase lots in source FIFO; other purchase earlier lot must remain unused.
- [ ] Test quantity and original price snapshot drift, original lot sum mismatch, supplier provenance, exhausted lots, third-party lots, duplicates, unsupported pre-lot fallback, unrelated product/tenant, invalid numeric types, accessor getter, no money/cost/account leakage, read-only frozen result and no input mutation.
- [ ] After observed RED, implement minimal M07 adapter reusing existing M05 audit and M07 FIFO preflight. Run full exact-head Foundation/source, local Workerd/D1 six shards, Chromium, security and Cloudflare safety; correct M07 failures test-first.
- [ ] Draft PR with source SHAs, RED/GREEN run IDs, exact file ownership, dependencies, review, release blockers and rollback. No merge until full current-head CI and owner review. Rollback only these M07-owned files.

**Production gates:** This planner does not prove financial paid/refund allocation from M06/M08, nor a current stock CAS, nor a Cash Session. Actual edit/delete or return writer must be a separately approved M03 SQL-atomic, M04-authorized and M08-reconciled operation with exact-once replay and no role auto-netting. Avoid reporting synthetic proofs as deployed functionality.
