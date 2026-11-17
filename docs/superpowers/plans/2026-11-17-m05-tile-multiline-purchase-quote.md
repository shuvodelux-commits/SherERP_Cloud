# M05 — Read-only multi-line Tiles purchase quote with exact paisa

**Issue:** #501 · **Workstream:** M05 · **Coordination:** #456 · **M03 owner:** #22
**Main base:** `7c81dca09f975fbda37586eb50c2763c7f8506df`.
**File ownership:** M05 only; add `src/modules/m05-tile-purchase-basket-preview.js`, `tests/m05-tile-purchase-basket-preview.test.mjs` and this plan.
**Dependencies:** merged #488 G1 source review candidate; existing `m05-tile-purchase-line-preview.js` and M03 read-only `tile-quantity-d1-proposal.js`. No public or production write authority.
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Purchase.gs grand/paid/due behavior; approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` multi-unit contract.
**M03/M04/M02 gates:** `docs/M03_PARALLEL_READINESS.md` still blocked for shared writes, immutable operation IDs, within-SQL auth, source identity and Party-link verification.

## Twelve-sentence Superpowers implementation overview

1. Existing M05 can price an individual Tile line using the server's trusted current D1 product revision.
2. Today's missing isolated capability is to combine multiple distinct current Tiles products into a single read-only purchase basket quote.
3. The new helper will call `previewTilePurchaseLineCandidateD1` for each requested original Product ID and Box/Pcs or Sqft quantity input.
4. It will reject supplied prices, unit factors, measurement revisions, tenant authority flags and supplier/payment claims instead of treating browser values as trusted.
5. It will preserve each returned measurement snapshot, source evidence, physical Pcs and exact nominal/manufacturer area as independent line evidence.
6. It will add independently rounded line prices using canonical nonnegative integer-paisa strings and bounded BigInt arithmetic, avoiding displayed-Sqft rounding drift.
7. It will preserve the frozen source `grandTotal=max(0,subtotal-discount)` and paid-amount clamping, explicitly separating requested from applied discount.
8. Duplicate Product IDs, missing or inactive catalog products, stale revisions and malformed or accessor-bearing inputs will reject without partial success.
9. It will expose a clear `postingAllowed:false` and `supplierReviewRequired:true` for the entire result and every line.
10. Local synthetic SQLite/D1 tests will exercise two-line Box/Pcs plus Sqft purchases, independent Box/Pcs prices and manufacturer coverage.
11. This task will not authorize a source Supplier/Party link, check stock availability, create a purchase/lot, pay cash/bank, change D1, or register an RPC.
12. We will preserve a real RED Node test log before the minimal GREEN module, then require full exact-head CI, review and conflict-free merge into main.

## API and acceptance

- Private API only: `previewTilePurchaseBasketD1({DB,lines,discountMinorText='0',paidMinorText='0'})`.
- Each line request: `{productId,request}`; `request` is the existing exact `pack` or `area` contract. A historical revision is never an allowed purchase-basket input.
- Result: `{mode:'read-only-tile-basket-preview',currency:'BDT',lines:[...],totals:{subtotalMinor,requestedDiscountMinor,appliedDiscountMinor,grandTotalMinor,paidMinor,dueMinor,paymentStatus},supplierReviewRequired:true,stockAuthority:'not-loaded',postingAllowed:false}`.
- Distinct active current-revision product evidence is required for every line. No monetary rounding after aggregation; each line already supplies a source-consistent `lineAmountMinor`.
- Reject money values outside 0..Number.MAX_SAFE_INTEGER paisa; this is only a JavaScript compatibility limit, not approval for such business transaction sizes.
- D1 fixture access is read-only SELECT against synthetic local database. No production/staging D1, shared migrations, SQL writers, `src/rpc/**`, `src/index.js`, Worker bindings, source Sheets or original UI modifications.
- M02 source group/Party identity, M04 server actor/session, M03 SQL-atomic supplier AP/stock/Cash Session, M07 reversal and M09 memo rendering must be independently approved.
- RED: test-only PR commit should fail on missing new module; GREEN: minimal module only; merge after exact-head full CI and mandatory review.
- Rollback: revert the three newly added M05 files, no data/financial/migration effects.
