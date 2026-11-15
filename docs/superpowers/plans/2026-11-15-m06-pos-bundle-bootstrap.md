# Superpowers M06 — original POS bundle bootstrap parity

**Frozen reference:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, source `legacy/source/Sales.gs::getPosBootstrap`, `legacy/source/Bundles.gs::getBundleDefinitions_` / `validateBundleDefinition_` / `getBundleAvailability_`, `legacy/source/StockLots.gs::buildLotPricingLadder_`. Follow current `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`. Base main after merged PR #107. This work is **read-only**, not an M05 schema/posting change.

## Objective

Allow original POS Bootstrap **Standard and Bundle** entries using a pure internal projection. Keep exact source behavior: bundle recipes follow the current product's `Bundle Revision`, active source `BUNDLE_COMPONENTS` rows; only active Standard component products are allowed; duplicates/missing/inactive/deleted/nested components and invalid component quantities invalidate **only that bundle** (the original hides its POS option). Bundle stock shown is min floor of each component's net `Current Stock` / per-set quantity, clamped at zero; not gross positive lot stock. Bundle stock is **display availability only** and does not reserve components, create lot/ledger records or authorize posting. Retain source product order; bundle sale price is its own product `Selling Price`, no lot pricing ladder for a Bundle, and source `purchasePrice` privacy uses the existing dual settings/permission gate.

## Design / isolated ownership

- Add a small frozen-source, byte-exact **pure** port `src/modules/pos-bundle-catalog.js` for the four needed Bundle functions `bundleProductType_`, `validateBundleDefinition_`, `getBundleDefinitions_`, `getBundleAvailability_`. No bundled Stock/FIFO posting logic; no new dependencies.
- Add `src/modules/pos-bootstrap-with-bundles.js` as a narrow wrapper over **merged** `projectStandardPosBootstrap(snapshot)` and the pure source functions. The wrapper validates `bundleComponentRows` upfront, feeds only Standard rows into the Standard projector, derives Bundle cards from source recipes and combines Standard/Bundle in original catalog order. Never edit existing Standard projector.
- Original `getPosBootstrap` also requires a trusted `pos.view` actor, source products/customers, lot rows, settings, Cash Session, bank/vendor projection and two distinct cost permissions. Both modules remain **internal only**. A future M04/M03 endpoint must check tenant and staff permission **before** reading sensitive source rows.
- No balance or Party merge: Customers with shared phones retain original IDs and due; active Cash Session result is required. No production D1, Cash, Bank, Stock, ledger, invoice, RPC, auth or original frontend changes.

## Test-first acceptance / evidence

1. **RED**: commit plan, independent `tests/fixtures/m06-pos-bundle-bootstrap-oracle.mjs` executing original native GAS `getPosBootstrap` with four Bundle functions in Node VM and strict synthetic read-service stubs, plus `tests/m06-pos-bundle-bootstrap.test.mjs` with full payload source comparisons and guard cases. The target wrapper/helper modules **do not exist** yet. Prove expected `ERR_MODULE_NOT_FOUND` in GitHub Actions.
2. **GREEN**: copy only four pure Bundle function declarations byte-for-byte from pinned `Bundles.gs` with AST test proving exact bodies. Implement minimal wrapper and cover mixed ordering, lot pricing vs bundle fixed price, revision activation, invalid recipe isolation, component net stock, negative stock, no double count, user-cost confidentiality, preserving original Customer IDs, source purity and missing trusted input rejection.
3. **VERIFY**: exact-head Node/source/Frontend, Chromium browser, M04 auth Workerd/D1, M03 existing real Workerd+D1 regression, Preview validation. Keep draft until green. No tests here claim live D1 bundle reads or atomic sale posting; those remain separate M05/M06/M08 gates.

## File / contract / rollback inventory

New files only: this plan; two new internal modules; independent native source oracle; focused tests. No modified existing production files. **RPC before/after unchanged**, no SQL/migrations, external data, actual financial effects, Cloudflare binding or deployment change. The Bundle helper has exact-byte source function bodies; wrapper is source-faithful adaptation to explicit snapshots, not byte-for-byte GAS. Revert PR to roll back; no data changes. Bundle posting, inventory allocation, returns, settlement and full UI E2E require the approved posting-core integration and real D1 atomicity proofs before M06 is done.
