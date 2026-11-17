# M05 — Trusted Product unit/Tiles stock metadata for source Products bootstrap

**Issue:** #617 · **UI:** merged M01 #581/#606, tracked UI #564 · **Shared D1/read integration:** M03 #22 · **Parallel board:** #456.
**Base main:** `e75cde4f49f511f3e95f7c07bd896cdd69bd9e81`.
**Allowed files:** new M05-only `src/modules/m05-products-ui-metadata-read.js`, `tests/m05-products-ui-metadata-read.test.mjs` and this plan.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; reviewed multi-unit `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.
**No M03/M04/M01 source ownership changes:** `src/db/**`, migrations, `src/rpc/**`, Worker and `legacy/source/products.html` remain untouched.
**Production D1 authority:** None. UI metadata is a read-only display candidate, never a stock or Product Add/Edit permission.

## Twelve-sentence Superpowers overview

1. The original Products bootstrap already projects source-parity products, categories, active unit names, stock valuation and Bundle availability.
2. The merged M01 Products stock renderer expects an optional `'M05 Stock Preview'` object for each Standard Product whose conversion or Tile facts are verified.
3. Without that object, the renderer correctly leaves the source stock text as a single canonical unit and must never guess a Box or Sqft.
4. A private M05 adapter can add this read-only object after the server has supplied one tenant-scoped, authenticated bootstrap and exact current conversion snapshots.
5. Each supplied configuration must identify its original Product ID and carry matching authoritative and snapshot unit revision text.
6. A Tiles configuration must additionally carry its authoritative current measurement revision and the exact M05 measurement input including Pcs-per-Box and coverage evidence.
7. The adapter must derive usable active unit masters from the same already-filtered Products bootstrap, never from hard-coded Box or Carton defaults.
8. Each conversion chain and Tiles measurement must pass the existing `formatM05ProductStockCell` validation with the original Product ID, physical base stock and source `Unit`.
9. Valid Standard products may display `2 Box 5 Pcs`, `5 Box 3 Pcs · 512.00 Sqft` or an exact Carton/Box/Pcs split while preserving all original stock and valuation fields.
10. Missing configurations leave the original row unchanged, whereas duplicate, foreign, stale, malformed or Bundle-stock configurations must fail closed without inventing facts.
11. The function will return cloned, UI-consumable snapshot rows and `postingAllowed:false` at the adapter result level without mutating source inputs or creating a public RPC.
12. Test-first RED precedes minimal GREEN, then exact-head Node/Workerd/Chromium CI and human review, and M03 independently owns source-scoped D1 loading and trusted actor/session checks.

## Proposed interface and acceptance

`attachM05ProductStockMetadata({bootstrap,configs})` returns the source bootstrap with only configured, validated Standard products carrying `'M05 Stock Preview'`. `configs=[{productId,unitRelations,unitRevision,currentUnitRevision,tileMeasurement?,currentTileRevision?}]`; both revisions are canonical positive integer strings and must match. `bootstrap.units` is derived from an authorized `projectProductsBootstrap` result and supplies only existing active unit names. The cloned metadata contains exactly `{productId,unitMasters,unitRelations,tileMeasurement?}` (the M01 controller's existing consumer format). The source `Current Stock` remains a signed physical integer, not a computed virtual lot. The validator must use the same tested `formatM05ProductStockCell`, so no second quantity or rounding algorithm is introduced.

RED acceptance: one Box/Pcs Stock cell; one nominal Tiles Sqft; Carton chain; signed OVERSOLD; source no-config fallback (no invented ratio); preservation of Bundle rows and price/valuation; wrong/missing source ID and Unit; stale unit/Tile revision; duplicate rows/units/configs; malformed/accessor-bearing snapshots; manufacturer missing evidence, wrong pack; input immutability; no D1/RPC or source mutation. Tests must not present this private adapter as production-authenticated without M03.

**Ordered handoff:** M05 reviewed pure adapter → M03 trusted per-tenant Products read query + source revision selectors → M04 session and allowlist integration for public read → M03 real D1 Product Add/Edit atomic writer with CAS/receipt and original stock lots → UI enabled only by reviewed server gate. `PARALLEL-SHARED-TRANSACTION-WRITES=BLOCKED` unchanged.
**Rollback:** revert these three new M05-only files. No data migration or financial rollback.
