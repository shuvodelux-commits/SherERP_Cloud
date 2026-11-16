# M05 — Read-only purchase-to-stock-lot lineage audit (2026-11-16)

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` source `Purchase.gs::createPurchase`, `PurchaseManagement.gs::updatePurchaseInternal_`, `DeleteEngine.gs::deletePurchase`, `StockLots.gs::createLot_`, `StockLots.gs::isInternalCostCorrectionSource_`. Refer to `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 Unified Party, and prior M05 stock-lot reconciliation PR #334.

## Thirteen-sentence M05 overview

1. Each frozen-source purchase line creates one stock lot tied to its original Purchase ID, Product ID, purchase date and supplier.
2. The frozen update flow can resize an existing lot, add a new line and lot, reassign all lot supplier IDs or retire a removed line with a zero-quantity lot.
3. The frozen delete flow retains the source purchase/items and marks its stock lots Deleted with zero remaining quantity rather than erasing all provenance.
4. Sales consumption and purchase returns legitimately reduce Remaining Quantity, so it cannot be expected to equal the original purchase item quantity.
5. This increment introduces an internal read-only audit of explicitly provided Purchases, Purchase Items and Stock Lots snapshots without loading or writing any database.
6. The audit retains exact legacy IDs and reports duplicate purchase headers, duplicate lot IDs, duplicate product lines and orphan purchase references.
7. For an active purchase, exactly one provenance lot for each product line is expected, but a separate retired zero-quantity lot can remain from historical edits.
8. The audit checks original lot quantity and purchase cost against the current item line, never equating consumed remaining stock to the original quantity.
9. A lot's Supplier ID must match the current purchase header when verified, while blank historical IDs remain unresolved rather than being guessed from name or phone.
10. Source-recognized opening, adjustment, legacy and OVERSOLD lots are not falsely classified as purchased stock, while unfamiliar lot sources require human review.
11. Any mismatch, missing linkage or invalid numeric evidence blocks a claim of import readiness without automatically correcting source data.
12. Superpowers implementation must commit failing tests first, verify the RED GitHub Actions log, then commit the smallest GREEN implementation and verify exact-head Node and safe preview CI.
13. This PR must not modify shared D1 schema or transactions, original GAS or business Sheets, Party mappings, authentication, RPC, UI or production deployment.

## Contract, files, safety

- Input: `auditPurchaseLotLineage({purchases,purchaseItems,stockLots})` from a trusted, already tenant-scoped snapshot. This is not an authentication check or live import.
- Output: `{ready,issues,summary}`; every issue has a stable code and relevant original IDs for human reconciliation, not a mutation instruction.
- New files: `src/modules/m05-purchase-lot-lineage.js`; `tests/m05-purchase-lot-lineage.test.mjs`; this plan.
- Out-of-scope: `src/db/**`, migrations, Worker and RPC routes, cash/bank/ledger posting, automated supplier-to-Party mapping, source `legacy/source/**`, multi-unit PR #313, frontend, Cloudflare bindings.
- Rollback: revert these three files; no D1 or live business records are affected.

## Test-first acceptance

Commit RED tests importing a nonexistent new module, including frozen-source source-shape guard assertions, valid multi-supplier/partial-consumption/retired-line cases, mismatches, duplicate and orphan provenance, deleted purchase safety, invalid snapshot rejection, immutability and no-public-RPC guard. Confirm the specific `ERR_MODULE_NOT_FOUND` on the GitHub RED commit. Commit the smallest GREEN helper preserving untouched original functions, then check all affected GitHub Actions and Node regression results before requesting merge. Do not claim ready for real migration or purchase posting on the basis of synthetic read-only tests alone.
