# M05 — Add Product unit/Tiles configuration and Products stock-cell preview

**Issue:** #563 · **UI handoff:** M01 #564 · **M03 integration:** #22 · **coordination:** #456  
**Base main:** `59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`.  
**Scope:** M05-owned new pure `src/modules/m05-product-form-stock-preview.js`, `tests/m05-product-form-stock-preview.test.mjs`, this plan. M01 alone edits the original `legacy/source/products.html`; M03 owns SQL, schema, auth, RPC, stock posting.  
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, optional approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`; reuse approved `normalizeProductUnitChain_`, `normalizeProductPriceProfile_`, `projectTileStockView`.  
**Release:** `PARALLEL-SHARED-TRANSACTION-WRITES = BLOCKED`.

## Twelve-sentence Superpowers design overview

1. The existing Products form currently accepts one stock number and one unit, so it cannot express a shopkeeper's Box/Pcs entry or Tiles Sqft setup.
2. The new M05 pure contract will accept an ordered, active-master-validated unit chain exactly as the approved multi-unit conversion helper does.
3. A product's purchase-price and selling-price anchor units and optional per-unit overrides must preserve their original values without re-rounding to an invented base-unit price.
4. The read-only add-form preflight will accept opening quantities by configured units and calculate exactly one canonical physical base-stock quantity.
5. Source units may be multi-level, such as one Bag equals five Box and one Box equals twenty Pcs.
6. For the requested ordinary stock example, two Box plus five Pcs must display as `2 Box 5 Pcs`, never just `45 Pcs`.
7. Tiles configuration must bind an explicit original product identity, current measurement revision, pieces-per-box, dimensions and optional evidenced manufacturer coverage to that unit chain.
8. For Tiles, five Box plus three Pcs must display their canonical whole pieces and the actual manufacturer-or-dimension-based Sqft on the same compact stock cell.
9. An area-entered Tiles opening quote must round up to whole Pcs and then expose the actual fulfilled Sqft, not pretend the entered area equals fulfilled area.
10. Duplicate or inactive unit names, broken conversion chains, mismatched Tile pack/revision, malformed input, spoofed prices and oversized quantities must fail closed.
11. Both APIs return `postingAllowed:false` and `stockAuthority:'snapshot-only'`, without creating a product, lot, price write, payment, Party obligation, source ID or public RPC.
12. The implementation follows a failing Node test committed before code, minimal GREEN using existing approved helpers, full GitHub CI and M01 UI handoff for bounded ui-refine-loop verification before production acceptance.

## Contract and acceptance

Private functions:
- `previewM05ProductAddForm({productId,unitRelations,unitMasters,openingUnits,prices,tileMeasurement?})`, returning current source-unit/pricing projections, one base quantity and compact Stock cell.
- `formatM05ProductStockCell({productId,unitRelations,unitMasters,baseStockText,tileMeasurement?})`, used for read-only product table display and signed OVERSOLD shortage, never for a stock transaction.
- `previewM05TileAreaOpening({productId,unitRelations,unitMasters,tileMeasurement,requestedSqft,fulfillment})`, using the reviewed exact `resolveTileQuantityFromCatalog` contract and then the same stock-cell formatter; actual fulfilled area is explicit.

Expected: Box→20 Pcs, stock 45 Pcs → `2 Box 5 Pcs`; Bag→5 Box→20 Pcs, stock 145 → `1 Bag 2 Box 5 Pcs`; Tile 24x24 in, Box=25 Pcs, 128 Pcs → `5 Box 3 Pcs · 512.00 Sqft`. Entered 355.00 Sqft for 24x24 in ⇒ 89 Pcs (3 Box 14 Pcs), **356.00 actual Sqft**, never fabricate 355 fulfilled. Manufacturer policy requires explicit coverage and evidence, and returns exact rational Area separately.

UI/QA handoff: M01 #564 owns original Product form/table markup, existing handlers/labels/style, Playwright desktop (1440) and mobile (390), dark mode only if supported, before/after screenshots and bounded ui-refine-loop. This M05 PR does not modify `legacy/source/products.html` or stage undeployed UI.
 
RED → GREEN: add tests before module; capture actual expected missing-module failure; write minimal pure source-backed implementation; check all exact-head CI, review before merge. Roll back only three new files. No D1 or financial effect.
