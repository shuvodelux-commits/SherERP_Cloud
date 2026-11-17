# M05 — Virtual Bundle stock availability source parity (read-only)

**Workstream:** M05 Products/Inventory/Purchases · **Issue:** #552 · **Board:** #456 · **Shared integrator:** M03 #22
**Base main:** `40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`. Previous PR #529 confirmed merged on main before starting.
**Paths:** Only new `src/modules/m05-bundle-stock-availability.js`, `tests/m05-bundle-stock-availability.test.mjs`, and this plan.
**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Bundles.gs` at existing frozen main.
**Source-function fidelity:** copy the exact source function declarations `bundleProductType_`, `bundleProductMap_`, `validateBundleDefinition_`, `getBundleDefinitions_`, `getBundleAvailability_` unchanged; use a stricter front-door trusted snapshot guard.
**Dependencies:** M03 owns shared `src/db/**`, migrations, shared posting/FIFO ID/receipts and `src/rpc/**`; M04 auth; M06 sale; M07 reversal; M08 Cash/Bank/Party accounts. All remain blocked for this isolated work.

## Twelve-sentence design overview

1. The frozen original ERP represents Bundle products as virtual kits that do not own physical stock lots.
2. A Bundle has its own independently configured selling price, regardless of component stock and purchase costs.
3. Current sellable kit availability is derived only from the smallest floor of current physical component stock divided by its required quantity per set.
4. The original source clamps negative OVERSOLD component stock to zero availability instead of treating a shortage as spendable stock.
5. The source permits fractional quantities for ordinary standard units such as Feet while requiring the number of available complete kits to be an integer.
6. Each Bundle has a current recipe revision and old recipe rows must never be silently substituted or reinterpreted when the current revision has changed.
7. The source requires every component to be a unique, active, nondeleted Standard product and rejects nested bundles and duplicate entries.
8. We will preserve the exact frozen helper implementations while adding a strict pure adapter that validates explicit source-shaped product and recipe arrays and original identities.
9. The adapter will reject malformed, duplicate, accessor-bearing, stale and nonfinite stock snapshots before calculating availability.
10. It will return a read-only Bundle product ID, current revision, original price, per-component stock evidence and supported kit counts, with no physical Bundle stock mutation.
11. This M05-only change does not authorize checkout, reserve FIFO lots, apply a StockMovement, create a source ID, post Supplier/Cash/Bank entries or register a public RPC.
12. A test-only RED commit will precede the smallest GREEN implementation, then the full current-head GitHub CI and human review must pass before main merge.

## Proposed interface and acceptance

- `reviewBundleStockAvailability({bundleId,products,componentRows})`.
- Trusted product row shape follows source `PRODUCTS`; component row shape follows source `BUNDLE_COMPONENTS`. Original `Bundle Revision`, `Current Stock`, `Product Type`, `Is Deleted`, `Quantity Per Set`, `Revision`, `Status` fields retain source meanings.
- Result `{mode:'read-only-bundle-availability',bundleId,revision,availableSets,bundleSellingPrice,components:[{productId,qtyPerSet,unit,currentStock,setsSupported}],stockAuthority:'snapshot-only',bundlePhysicalStock:false,postingAllowed:false}`.
- Validate no duplicate Product IDs or active current recipe entries, reject inherited/prototype-colliding IDs/accessors, malformed negative/nonfinite price, stale missing recipe and missing components. Keep current product stock observation as supplied, never grant a stock lock.
- Tests prove byte-exact source declarations against `legacy/source/Bundles.gs`, source function output parity, three-component constrained availability, negative stock clamp, fractional quantities, old revision isolation, missing revision, duplicate and nested component, inactive/deleted component, duplicate Product ID and malicious getter rejection, immutability and no RPC/writes.
- **No D1/HTTP/SQL changes:** local Node tests and repository Workerd/D1/browser full CI still mandatory before merge; no production D1 binding or remote source data use.
- **Rollback:** delete/revert these three new isolated M05 files; no data or financial rollback.
