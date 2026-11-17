# M05 — Mixed ordinary/multi-unit + Tiles purchase basket preview

- **Issue:** #527, **source handoff:** #485/#488, **tile parent:** #501/#506, **coordination:** #456, **M03 owner:** #22.
- **Base main:** `5d7b02ed28e123ec7d10060a6d89bc2b64ba7ba8`.
- **Exclusive M05 additions:** `src/modules/m05-mixed-purchase-basket-preview.js`, `tests/m05-mixed-purchase-basket-preview.test.mjs`, this plan.
- **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; approved optional `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.
- **No protected files:** no `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, shared posting, receipt/ID kernel, Cash Session, Worker, original frontend or source data.
- **Release:** PARALLEL-SHARED-TRANSACTION-WRITES = BLOCKED; this is a private read-only contract, not a deployable purchase.

## Twelve-sentence overview

1. A real hardware purchase can include ordinary single-unit goods, multi-unit cable and tile products in the same supplier invoice.
2. The already-merged M05 source purchase validator prices ordinary and mixed-unit goods but not D1 Tiles measurements.
3. The merged M05 Tiles quote resolves current versioned catalog prices and exact Box/Pcs/Sqft quantities but has no supplier invoice.
4. A new read-only M05 composition will assemble one standard source purchase with one current-D1 Tiles basket.
5. The standard purchase still uses original Supplier ID, source-shaped editable legacy single-unit pricing, and trusted source product/conversion rows.
6. Its multi-unit components must retain original conversion IDs, factors, unit prices and exactly one normalized stock-unit quantity.
7. Each Tile preserves original Product ID, current unit and measurement revision, selected price anchor, integer-paisa line cost and exact nominal versus manufacturer area.
8. The composition must never reinterpret a historical conversion or compute money from rounded Sqft display.
9. Convert legacy source numeric totals into integer paisa only if every line and the source subtotal agree to cent precision.
10. Reject cross-family duplicate Product IDs, ambiguous source IDs, unreviewed discount or tender inputs, invalid or forged fields, stale Tiles and overflowing totals.
11. Return a clearly non-postable source snapshot with a Supplier-review flag, no Cash/Bank/Party posting and no public RPC.
12. Preserve RED evidence in GitHub before the minimal GREEN module, run full exact-head CI and require code review before merging the three M05-only files.

## Candidate input/output

- `previewMixedPurchaseBasketD1({DB,standard:{payload:{supplierId,items},products,suppliers,conversionRows},tileLines,discountMinorText='0',paidMinorText='0'})`.
- Requires at least one standard line and one Tiles line; existing dedicated helpers handle single-family quote cases.
- Standard `payload` may include original Supplier ID and line item entries but **must not include** `discount`, `paidAmount`, `paymentMethod`, `bankAccountId`, actor/tenant claims, source operation ID or client-supplied post permissions. Basket monetary preview totals are supplied only as **canonical integer-paisa text**.
- The source preflight may accept an editable base unit price for an ordinary original single-unit line as in the frozen GAS source; mark it `editableLegacyPrice:true` and never treat it as D1 price authority.
- New response `mode='read-only-mixed-purchase-basket-preview'`, `sourceSupplierId`, `sourceSupplierName`, `standardLines`, `tileLines`, `totals`, `supplierReviewRequired:true`, `paymentReviewRequired:true`, `postingAllowed:false`.
- Example standard subtotal 74800 paisa plus Tiles 134267+136800 gives subtotal 345867, discount 1067 gives grand 344800, paid 120000, due 224800.
- **Tests**: source fidelity 145 Pcs/730 BDT and pipe 18 BDT; 53+54 Tiles Pcs; manufacturer coverage; duplicate across families before D1 reads; inactive/stale Tiles; original supplier and conversion validation; malformed arrays/accessors; invalid money; mixed legacy noncent amount fail-closed; no stock/cash/Bank/Party writes or RPC.
- **Dependency handoff**: M02 human-reviewed source Supplier→Unified Party role link, M04 actual actor/session, M03 atomic journal + CAS + exactly-once receipt and M07 returns remain independent prerequisites. M09 owns eventual invoice rendering, not this source quote.
- **Execution**: plan → RED test-only commit and failing CI log → minimal GREEN module → full 44+ current-head GitHub CI and reviews → merge to main and verify files → issue #527 closure. Revert three additions for rollback; no data effects.
