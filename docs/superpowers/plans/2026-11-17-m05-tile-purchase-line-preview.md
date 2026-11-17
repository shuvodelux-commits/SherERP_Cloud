# M05-0016 — Tile purchase-line preview from immutable D1 measurement and unit price
**Dependency:** stacked on M03 #441 `m03/tile-d1-quantity-proposal-0015`; #438–#440 are already on main. Do not merge directly to main before #441 is green, reviewed and merged. Source truth: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; optional multi-unit sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.

## 13-sentence Superpowers overview
1. M05 needs a trustworthy physical Pcs and exact cost proposal before any tile purchase can create a stock lot.
2. This increment uses the already-tested M03 D1 measurement/quantity proposal instead of introducing an inventory engine.
3. Pricing uses the persisted tile purchase unit and exact price texts, never a browser-supplied factor or unit price.
4. Sqft purchasing requires the explicit versioned purchase Sqft override; missing prices fail closed without guessing.
5. Box/Carton purchasing chooses an exact anchor price or a verified named pack conversion purchase override.
6. Pcs purchasing chooses the exact Pcs anchor price or explicit stock-unit purchase override.
7. Contradictory price anchors and overrides are rejected using decimal-string equality rather than binary floating point.
8. The existing pure tile price helper computes an exact rational total and rounds once to BDT minor units.
9. A proposed receipt quantity is always a whole canonical Pcs count while Box/Pcs/Sqft remain descriptive commercial units.
10. Only an active, nondeleted product at the current revision receives a new-purchase quote; historical revisions remain available only for separate review and returns.
11. Return immutable measurement, selected price, requested area and physical unit snapshots without modifying source rows or D1.
12. TDD must prove nominal, manufacturer, three pricing units, inactive/historic rejection, missing evidence and local Workerd isolation.
13. No supplier identity approval, FIFO lot write, stock CAS, cash/bank movement, Party payable, purchase document, public RPC or production D1 migration is enabled here.

## API and contract
New internal module `src/modules/m05-tile-purchase-line-preview.js` exporting `previewTilePurchaseLineCandidateD1({DB,productId,revision='current',request})`. It reads through `proposeTileQuantityCandidateD1` once, returns `null` for missing/unconfigured tile, and otherwise returns the existing candidate DTO plus `purchasePreview` holding `receivedPcs`, trusted `pricingUnit`, `unitPriceText`, `billingQuantity`, `lineAmountMinor`, `exactAmount`, `priceSnapshot`, `roundingDeltaMinor`, and `postingAllowed:false`. The selected purchasing unit is dictated by `product_tile_measurement_revisions.purchase_pricing_unit`, not an input. Source anchor price applies only when its unit matches the selected commercial pricing unit. If pack price and matched anchor price both exist but disagree, reject. The preview preserves full exact quantities, source product/revision identity and evidence, yet does not claim verified supplier, available stock, receipt lot or legal financial authority.

## Acceptance and guarded continuation
- RED: commit tests and plan before module; verify `ERR_MODULE_NOT_FOUND` from GitHub CI.
- GREEN: minimal pure composition and a dedicated ephemeral real local D1 fixture workflow; full Node suite/source/UI checks.
- Real stock posting is a **separate** M05/M03/M04 reviewed SQL-atomic transaction requiring original supplier IDs, cash-session policy, lot provenance, recorded original unit+money snapshots, idempotency, CAS, rollback and D1 concurrency tests.
- GitHub branch/PR only; child remains draft until parent #441 merges and exact-head CI passes. No changes to original Sheets, live ERP, production or remote D1.