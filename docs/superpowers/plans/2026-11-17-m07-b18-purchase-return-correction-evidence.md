# M07-B18 — Purchase Return Correction: Original Stock & Finance Evidence Gate

**Base:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02` on 2026-11-17; B17 PR #526 was merged on main. **Owner:** M07; issue #314 and coordination #456. **Runtime scope:** read-only, trusted source snapshot; zero SQL/RPC/I/O.

## Implementation overview (12 sentences)
1. Original `PurchaseReturn.gs` creates and reads Purchase Returns, but does not implement native Purchase Return edit/delete handlers.
2. B18 therefore will not falsely present an original edit/delete handler as a migrated feature.
3. A small M07-only pure preflight will assemble immutable evidence for a *proposed future* original Purchase Return cancellation.
4. Explicit `Edit` requests will fail closed as unsupported instead of approximating old behaviors.
5. The preflight requires a trusted source-shaped, stable Return ID, Purchase ID, tenant and expected source marker.
6. Every active original Return line must have a positive base quantity and authoritative stored line total.
7. The original Return's Stock Movement rows must reconcile precisely to those base quantities and uniquely identify source-owned Purchase lots.
8. A proposed lot restoration may never exceed the source lot's original quantity.
9. Cash refunds must be evidenced by exactly one original `CASH_BOOK` Purchase Return Credit row.
10. Supplier Credit returns must instead be evidenced by exactly one original `SUPPLIER_LEDGER` Purchase Return Credit row, with the original Supplier ID.
11. Ambiguous, duplicated, deleted, contradicted or previously corrected evidence must fail closed without touching stock or money.
12. M03/M04/M08 must independently verify source authenticity, active sessions and permission, later stock/settlement changes, CAS, exact-once replay and atomic money+inventory reversal before a real endpoint could ever be enabled.

## Source authority and actual behavior
Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`:
- `PurchaseReturn.gs::completePurchaseReturn` appends `PURCHASE_RETURN`, `PURCHASE_RETURN_ITEMS`, `STOCK_MOVEMENT` with `Type:'Purchase Return'`, and **either** `CASH_BOOK` Credit **or** `SUPPLIER_LEDGER` `Type:'Purchase Return Credit'` Credit.
- `getPurchaseReturnDetail` only reads header/items; no native Purchase Return Edit or Delete entrypoint in the pinned module or native DeleteEngine.
- `StockLots.gs::planPurchaseReturnLotReduction_` restricts source lot reduction to original Purchase; never infer a lot from current catalog or later unrelated purchases.
- Original Return line prices are economically discounted at invoice level; stored `Line Total` controls money verification, not a rederived current unit price.
- M07-B15/B16 offer historical mixed-unit *purchase return creation* previews, not a posted cancellation mechanism.

## Exclusive paths and dependencies
- `docs/superpowers/plans/2026-11-17-m07-b18-purchase-return-correction-evidence.md`
- `tests/m07-purchase-return-correction-evidence.test.mjs` (**RED before implementation**)
- `src/modules/m07-purchase-return-correction-evidence.js` (**GREEN only**)

No edits to `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `wrangler*`, posting or reversal kernel, auth, M05/M06/M08 code, original GAS/UI, or real staging/production D1. Other M03/M04 PRs may proceed without overlapping these M07-owned paths.

## Contract
`reviewHistoricalPurchaseReturnCorrection(source,intent)` consumes **previously trusted** exact objects:
- `source={tenantId,purchaseId,returnId,sourceHash,returnHeader,returnItems,stockMovements,purchaseLots,cashBook,supplierLedger}`.
- `intent={tenantId,purchaseId,returnId,correctionId,expectedSourceHash,reason,mode}`.
- `mode:'Edit'` is `DECLINED: NATIVE_PURCHASE_RETURN_EDIT_UNSUPPORTED`.
- `mode:'Delete'` may produce `PLAN_ONLY` with saved identity, frozen `restoreOriginalLots:[{productId,lotId,sourceRowIndex,baseQty,remainingAfterRestore}]`, saved Return source row references, and a single `financialEvidence:{kind,sourceRowIndex}` without calculating new money.

The original Return header must be active and match Purchase/Supplier. Each item belongs to the Return/Purchase, is unique by product, has positive integer base units and a nonnegative saved monetary line total; all line totals in paisa must reconcile exactly against the original header. Stock Movement proof must be all original `Type:'Purchase Return'`, `Reference: returnId`, positive integer `Quantity Out`, zero `Quantity In`, stable unique movement and source-row IDs, and a matching original Purchase-owned lot. The stock movement quantities must sum exactly to each Return line's original base quantity. Matching original-owned lot references must have valid nonnegative integer capacity and `remaining + restored <= original`; no deleted, foreign, duplicate or unseen lot can be substituted. For Cash, exactly one active matching Cash Book record has `Credit` equal to the original header total and zero `Debit`, with **no** matching Supplier Credit row. For Supplier Credit, exactly one active Supplier Ledger record has the same `Credit`, zero `Debit`, matching Supplier ID, and **no** matching Cash refund row. Reject source/intent accessor properties, malformed arrays, unknown keys, caller-selected lot/amount/factors, mismatched source marker, previous correction marker and wrong source lineage. `PLAN_ONLY` carries `nativeMutationAvailable:false,readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false,replayResolved:false,accountingReconciled:false`.

**CRITICAL LIMITATION:** This is only a static evidence preflight. It cannot show if a later sale, settlement, stock reservation, cash reconciliation or pending retry makes an undo unsafe. A passing plan does *not* authorize rollback; M03 must fail closed until the single atomic posting/reversal kernel and M04/M08 governance are approved. No live cancellation method is implemented.

## Superpowers RED→GREEN / PR gate
1. Commit plan + tests while the new module is absent and observe true GitHub RED (`ERR_MODULE_NOT_FOUND`).
2. Implement minimal pure evidence composer on the same branch; no additional dependency.
3. Verify focused tests, `npm test`, 6 local Workerd/D1 shards, Chromium, source/auth/security and Worker preview safety on the exact final SHA.
4. Open one narrow PR against main with source SHA, evidence and risks. Wait for owner review, current-head CI, no conflicts and dependency authorization before merge.
5. Rollback only these three new M07-only files; no D1 migrations or source data affected.
