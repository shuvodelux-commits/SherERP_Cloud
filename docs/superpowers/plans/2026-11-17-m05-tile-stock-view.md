# M05 — Tile canonical stock view (Box / Pcs / Sqft, nondeployable)

**Issue:** #314, shared coordination #456
**Workstream:** M05 — Products, Inventory & Purchases
**Base main SHA:** `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`
**Owner:** M05 exclusive additions, no M03 shared path reservations
**Dependencies already present on main:** M02 exact tile quantity contract, M03 D1 catalog candidate contract, M05 #447 and #453 isolated tile receipt proofs, M05 price profile #434 and edit preflight #425
**Blocked:** Any integration with a live D1 stock/ledger writer, public RPC, or print/UX activation, per docs/M03_PARALLEL_READINESS.md
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` physical Products/StockLots/FIFO semantics; user-approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` `ProductUnitConversions.gs::formatProductStockView_` for source unit display convention. Tiles exact area source is existing reviewed `src/modules/tile-quantity-contract.js`; no original GAS changed.

## 12-sentence implementation overview

1. SherERP stock quantities are canonically tracked in physical base units, and approved Tiles use integer Pcs with product-specific box dimensions and Sqft coverage.
2. Existing M02 tile quantities and M05 receiving/quote proofs on main already establish exact rational conversions.
3. They do not yet expose a focused M05 read-only projection of a **stored signed physical stock balance** into Box/Carton, Pcs and Sqft.
4. This change adds exactly one M05-owned pure function for that display-oriented review contract.
5. It accepts an explicitly trusted source canonical signed Pcs quantity in a decimal-free string, along with current or historical catalog and matching measurement revision snapshots.
6. Product identity, revision, physical Box factor and the authoritative box label are verified by reusing `resolveTileQuantityFromCatalog` rather than inventing a second conversion engine.
7. Positive balances decompose into full boxes and remainder Pcs using the existing deterministic whole-Pcs logic.
8. Zero balances still validate measurement provenance, but display zero quantity without inventing a receipt.
9. Negative OVERSOLD balances remain clearly identified as shortages and do not become positive available inventory.
10. Nominal and explicitly evidenced manufacturer coverage are reported separately and use exact signed rational Sqft without repricing or changing historical measurement snapshots.
11. Tests precede implementation and cover product revisions, mismatch rejection, noninteger/unsafe stock quantities, immutability, and no Worker/D1/RPC mutation.
12. This internal helper is not authorization, stock valuation, inventory reservation, a transaction writer, a POS shortcut, or permission for public deployment; M03 owns later integrated data reads and posting.

## Acceptance and impact

- API: `projectTileStockView(catalog, measurement, basePcsText)` returns an explicitly labeled read-only DTO: `{mode,productId,revision,basePcs,stockState,boxes,extraPieces,packUnitName,actualSqft,nominalSqft,displaySqft,measurementSnapshot,postingAllowed:false}`.
- Use `stockState='oversold'` for negative quantities, `'zero'` for zero, `'available'` for positive; `boxes/extraPieces` give **magnitudes**, not claims that OVERSOLD stock is available.
- Read-only input must be a canonical integer string in the safe JS whole-piece range; no object coercion, negative zero, leading zeros or invalid decimal strings.
- Allowed paths: `docs/superpowers/plans/2026-11-17-m05-tile-stock-view.md`, `tests/m05-tile-stock-view.test.mjs`, `src/modules/m05-tile-stock-view.js` (all new, single-owner M05).
- Affected existing files/tables/RPC: **none**; no M03 src/db, migrations, src/rpc, src/index.js, Worker, session boundary, source GAS, production UI, actual stock/Cash/Bank/Party changes.
- TDD: plan, test-only RED commit (expected ERR_MODULE_NOT_FOUND), then minimal GREEN helper; require full exact-head CI and owner review before merge.
- Rollback: revert the three new files. No deployed D1 rollback/roll-forward or data mutation exists.
