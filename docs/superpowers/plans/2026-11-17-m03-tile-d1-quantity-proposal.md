# M03-0015: persisted tile quantity proposals, private read-only composition

**Dependencies now on main:** #438 exact tile quantity contract, #439 inert immutable D1 tile measurements, #440 private D1 revision reader. **Tracking:** existing M02/M03 tile capability, no change to source data or public API.

## 12-sentence implementation overview
1. Provide a private candidate adapter that reads a stored tile revision and computes a whole-piece proposal.
2. Reuse the committed M03 measurement reader rather than introducing alternate product or tile tables.
3. Reuse the committed M02 rational Box/Pcs/Sqft contract rather than a floating-point calculator.
4. Select a pinned product and its current revision or an explicitly requested historical positive revision.
5. Allow pack input as Box/Carton count plus extra Pcs and area input as requested Sqft with loose or box-only fulfillment.
6. Preserve physical Pcs stock basis and the actual historic native pack label.
7. Return requested Sqft, exact deliverable area and full input/measurement/unit snapshots for review.
8. Preserve optional manufacturer evidence and its selected policy without automatic substitution.
9. Return null for nonexistent or untiled catalog rows and reject inconsistent or malformed trusted configuration.
10. Never imply live stock, selected price authority, customer/supplier posting rights or authorized returns.
11. Test nominal, manufacturer, historical pack change, invalid requests, read-only behavior and private HTTP isolation using Node SQLite and actual local Workerd/D1.
12. Keep SQL migrations, original UI, auth/public Worker RPC, invoice and financial writers unchanged.

## API and ownership
New internal `src/db/tile-quantity-d1-proposal.js` exports `proposeTileQuantityCandidateD1({DB,productId,revision='current',request})`; it returns `null` if no trusted tile measurement exists; otherwise the existing immutable catalog/evidence/pricing reader DTO plus `quantity` derived solely via `resolveTileQuantityFromCatalog`. Pricing in this DTO is metadata only; no price amount, payment, stock movement or document posting is authorized. This is still a single-business D1 candidate, not shared-tenant isolation.

## TDD / merge gate
Commit tests first and observe RED specifically for the missing adapter; then add the minimal composition for GREEN. Run full foundation (Node/source/UI), dedicated real Workerd D1 and all exact-head CI. Existing broad M03 test exemptions on #439/#440 are recorded owner waivers, not passing tests; do not disable or conceal their results. Do not merge this new PR with pending checks or deploy production D1.