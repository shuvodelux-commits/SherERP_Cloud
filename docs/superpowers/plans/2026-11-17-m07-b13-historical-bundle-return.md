# M07-B13 — Historical Bundle Component-Lot Return Preflight

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development. Commit failing regression first, verify GitHub RED, commit minimal GREEN, verify entire exact-head CI before review.

**Goal:** Produce a **read-only source-linked quantity plan** for returning original bundle sets using immutable sale-time `SALE_BUNDLE_COMPONENTS` and `SALE_ITEM_LOTS`, without recalculating current bundle recipes, posting inventory or inferring financial refund.

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `Bundles.gs::getSaleBundleSnapshot_`, `buildSaleStockDemands_`, `StockLots.gs::planSaleReturnRestoration_` and `planSalesReturnStockUndo_`. Existing `src/modules/pos-bundle-demands.js` is original function byte-parity and may be imported by tests, not changed.

**Architecture:** One M07 pure helper `planHistoricalBundleReturn(source,intent)`. The caller supplies already-trusted immutable source Sale, bundle snapshot, component-owned `SALE_ITEM_LOTS` consumption positions and outstanding quantities, and immutable source links. Each original bundle component uses its own reverse-source-row order, independent of other components. Demand per physical component is `returnSets * originalQtyPerSet`; source and outstanding rows must reconcile exactly with `setsSold` and `activeReturnedSets`. The output lists component-level restoration intentions but **one** bundle financial return line requiring separate original invoice/discount/tender authorization.

## File ownership / dependency handshake

- **Module:** M07, issue #314 and board #456; start fresh `main@bcd2d3adbd03f35612c50c1a144a472b1683b412`.
- **Upstream:** M06 original bundle-demand `src/modules/pos-bundle-demands.js` already merged; M07 B11 PR #481 merged with 44/44 green. M07 B12 PR #487 in-flight but **not a dependency**; B13 owns disjoint files.
- **Own these exact paths:** `docs/superpowers/plans/2026-11-17-m07-b13-historical-bundle-return.md`, `tests/m07-historical-bundle-return.test.mjs`, `src/modules/m07-historical-bundle-return.js`.
- **No shared writes:** no `src/db/**`, migrations, `src/rpc/**`, shared posting, source adapters, Worker bindings, `wrangler*`, original GAS/UI or remote D1. No new npm dependencies, public routes, auth claims, Cash Session effects or Customer/Supplier/Cash/Bank mutation.
- **Order:** #481 merged; #487 and this PR can be independently reviewed, merge one after full exact-head green and review; M03 alone integrates any future true transactional writer.

## Input and fail-closed contract

`source` is an own-data trusted normalized snapshot:
`{tenantId,invoiceId,bundleId,sourceHash,snapshotRevision,setsSold,activeReturnedSets,historicalComponents,componentConsumptions}`.
`historicalComponents` are exactly saved `[{productId,qtyPerSet,unit}]` from original `SALE_BUNDLE_COMPONENTS`, nonempty with unique standard-product IDs, positive integer units. `componentConsumptions` hold immutable source row identity for each physical line: `{rowIndex,sourceLinkId,invoiceId,sourceSaleProductId,productId,lotId,originalBaseQty,remainingBaseQty,sourceKind}`, only `LOT` supported; each original owned consumption ID/lot must be unique and allocated to the saved bundle. Original component quantities reconcile to all source rows, while current surviving quantities per component must equal `(setsSold-activeReturnedSets)*qtyPerSet`.

`intent` must be exactly `{tenantId,invoiceId,bundleId,returnId,returnSets}`, strictly valid ID and positive integer count, without caller-supplied recipe, stock lot, amount, SQL, actor, roles, permission or refund. `returnSets<=setsSold-activeReturnedSets` is required; the unknown tenant/invoice/bundle never returns other business data. Existing edit/delete or a race must be revalidated atomically by M03 and M04 in production.

Result on safe original-lot source: `{status:'PLAN_ONLY',data:{tenantId,invoiceId,bundleId,returnId,returnSets,bundleRevision,componentPlans:[{productId,baseQty,restorations:[{lotId,sourceLinkId,sourceRowIndex,baseQty}]}],readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false}}`. Always return frozen copies, never mutate source arrays. No monetary refund, purchase cost, party identity, profit or stock balance inferred. Unsupported source kind and incomplete legacy line fail closed as `DECLINED` or `NEEDS_REVIEW`. Master Bundle revisions may change without changing historical output.

## Superpowers steps

- [ ] Commit plan and test-only RED suite using original M06 `buildSaleStockDemands_` oracle (no fabricated financial effects), including 2 sets, two components split across four original lots, prior returns, exact original quantity, missing duplicate and mixed-component source links, negative/overflow, tampered revision, source money abstention, no account exposure.
- [ ] Verify actual GitHub Foundation Node RED log on exact test SHA shows the new M07 module missing, not unrelated production test failures.
- [ ] Implement minimal pure M07 helper in the own file. Return exact original-recipe component stock preview, no D1.
- [ ] Verify exact-head Foundation, original source audit, browser/Chromium, existing real Workerd/D1 six shards, auth/Cloudflare safety. Fix any M07-owned regression with TDD, do not waive checks.
- [ ] Open scoped draft PR with full exact files, source SHAs, RED/GREEN CI evidence, risk and rollback. Leave unmerged until 100% required CI and owner review.

**Production blockers:** source `SALE_BUNDLE_COMPONENTS` import proof, M05 consumption-link IDs, M06 persisted original sale and split tender, M03 atomic source-safe lot/account reversal, M04 tenant/session/RBAC, M08 Party/Cash/Bank ledger, M10 source reconciliation. This read-only proof cannot by itself enable the original GAS return mutation or its UI.
