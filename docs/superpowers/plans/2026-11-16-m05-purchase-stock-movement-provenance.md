# M05 — Purchase stock-movement provenance and quantity conservation (2026-11-16)

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Purchase.gs::createPurchase`, `PurchaseManagement.gs::updatePurchaseInternal_`, `DeleteEngine.gs::deletePurchase`, `Config.gs::STOCK_MOVEMENT/PURCHASE_ITEMS/PURCHASES`. **Target:** `shuvodelux-commits/SherERP_Cloud` main at `de7431155c9d0b91fd513def417e1344721a6c52`. Mandatory `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 apply.

## Thirteen-sentence engineering overview

1. The pinned `createPurchase` creates one Stock Movement per Purchase Item, with Type Purchase, Reference Purchase ID, a positive Quantity In and a purchase lot ID.
2. The pinned `updatePurchaseInternal_` deletes and rewrites the Purchase Items snapshot, then adds a Purchase Update Stock Movement only for each nonzero product quantity delta.
3. An added product line can therefore have a Purchase Update movement without an initial Purchase movement, which is valid.
4. A removed purchase product can have zero current Item rows while retaining original Purchase and Purchase Update movements whose signed sum is zero.
5. The pinned `deletePurchase` preserves the Purchase Items history, appends a Purchase Deleted movement for each remaining product with positive Quantity Out, and soft-deletes the Purchase header.
6. Purchase Return stock movements use a separate return reference and must never be conflated with the Purchase ID movement stream or counted twice.
7. An internal read-only `auditPurchaseStockMovementProvenance` will compare the sum of Purchase and Purchase Update quantities by Purchase ID and Product ID with current Purchase Item quantities for active purchases.
8. For deleted purchases it will additionally include Purchase Deleted quantities and require the net movement effect to be zero for every product.
9. Missing or duplicate source IDs, orphan movement references, impossible movement sign/direction, duplicate initial Purchase movement for the same product and unmatched product quantities must become deterministic audit issues.
10. The source Update movement may intentionally have an empty Lot ID for a newly added product, so this audit must not invent an invalid requirement that every Update movement names a lot.
11. No Stock Movement Balance Stock value can prove the total business-stock ledger on its own, because unrelated sales, adjustments and vendor activity interleave; that remains a different audit.
12. A Superpowers RED tests-only commit must fail in GitHub Actions with the missing module before the minimal GREEN code, followed by full exact-head test/build/check verification.
13. No D1 migration, public RPC, original GAS/Sheets, cash/bank/supplier postings, shared M03 transaction owner, M02 schema or live preview bindings will change.

## Exact scope and acceptance

- Add only `docs/superpowers/plans/2026-11-16-m05-purchase-stock-movement-provenance.md`, `tests/m05-purchase-stock-movement-provenance.test.mjs` and `src/modules/m05-purchase-stock-movement-provenance.js`.
- Input trusted source-shaped `{purchases,purchaseItems,stockMovements}` arrays, no database reads and no permission decisions.
- Output `{ready,issues,summary}`; issues have stable `code`, `purchaseId`, `productId`, and optionally `movementId`, `expected`, `actual`. A failed audit is **not** permission to rewrite legacy stock records or auto-correct quantities.
- Filter Stock Movement by exact `Type in ['Purchase','Purchase Update','Purchase Deleted']` and require its original Purchase ID in `Reference`; ignore other types (in particular Purchase Return).
- For active purchases, signed original Purchase plus Purchase Update quantity equals the current Purchase Items quantity per product, including disappeared historical lines expected to net zero. Deleted headers have a Purchase Deleted quantity reversal and entire net movement zero. Do not add purchase returns in this equation; their movements are separate.
- Nonfinite, malformed, zero/negative or dual-direction movement values fail closed. Duplicate purchase IDs, duplicate Purchase Item products and duplicate Movement IDs block import. Malformed accessor-bearing snapshots throw before values are used.
- Do not treat the audit as tenant authorization or record editing; independent M04 auth and atomic M03/D1 purchase posting are separate release gates. Multi-unit PR #313 remains open and this assumes source quantities are already in the canonical base quantity.
- Test source snippets are extracted from pinned GAS, and multiple synthetic stories cover source creation, update increase/decrease, added/removed lines, deletion, purchase-return exclusion, corrupted/missing/duplicate movement, orphan and malformed snapshots.
- Rollback removes exactly the three new files; zero business-data changes.

**Open dependencies:** M02 versioned Products/Purchases/Items/Lots/Movements D1 tables, M03 idempotent atomic ledger and stock posting, M04 permission/session and M07 purchase return reversal; M10 historic row-ID and quantity reconciliation before any production import. PR #379 Update form is independent and remains on its own branch.
