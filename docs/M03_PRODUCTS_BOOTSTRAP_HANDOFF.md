# M03 #621 — Authenticated Products D1 bootstrap, private local contract

**Workstream:** M03 integrator #22 · task #621 · coordination #456  
**Start base:** `main@826f63662588f2961d70a7e0859b6e5fa94516ae`  
**Upstream merged:** M03 #614; M05 #618; M02 migration 0013; M04 persistent session/RBAC foundation  
**Independent open M03 PR #625:** touches `tests/m03-frozen-source-readback.test.mjs` and its own plan only. This branch does not edit those files.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` for original Products identity; supplementary multi-unit formulas are the separately approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Implementation boundary

Private internal `createM03AuthenticatedProductsBootstrap({DB},{now:serverClock}).getProductsBootstrap_({token})`, with a server-owned clock. **The caller may not supply tenant, Product ID, actor, role, price, unit configuration or clock.** A raw opaque bearer is hashed as bytes with SHA-256, exactly as M04's persistent D1 session schema expects. The first D1 query must prove the unrevoked/unexpired/nonidle session, active user and role, current auth/credential/role epochs and an actual boolean `products.view` permission (or the source Administrator role), and recover the tenant exclusively through the trusted session-to-tenant D1 link. On denial, no Product query runs. All subsequent fixed SQL SELECTs repeat the current M04 authority predicate, joining records by the resolved tenant; a final reauthorization fails closed on mid-read revocation. No request-level cache or unguarded Product SELECT.

The source core is **the real numbered migration 0013**, not an invented replacement `products` schema. We preserve original Product IDs and verify its immutable linked canonical `legacy_product_snapshots` Product ID, physical sheet row and base Unit. The original Quantity comes from an explicitly tenant-scoped physical-stock staging table, never Product name matching, browser input or multiplication of Boxes. Unit masters, category masters, source lots, Bundle components, current Product unit revision/conversions and Tile measurement evidence also come from the same tenant boundary. Deleted Products are filtered by the existing source M05 projection, and Bundle availability/stock valuation are computed by **merged M05 `projectProductsBootstrap`**. Optional Box/Pcs/Sqft metadata is validated and attached by **merged M05 `attachM05ProductStockMetadata`**, without a duplicate conversion or Tiles area algorithm. Where current verified metadata does not exist, it does not invent conversion text.

**Tile evidence:** the local-only staged measurement text has a declared current measurement revision and SHA-256 digest. The read re-hashes the exact staged text before accepting the current Unit revision and passes it to M05's nominal/manufacturer evidence validator; mismatched revision, changed dimensions, pack factors, missing manufacturer proof and wrong base Unit reject. A digest held in the same synthetic DB is **not independent source custody** and is NOT an approved real manufacturer import.

## Explicitly nondeployable test-only schema

The existing migration 0013 `products`, `product_unit_profiles`, `product_unit_conversions` and the M04 session schema **do not currently provide a reviewed multitenant tenant ID + live stock model**. Local Workerd/D1 therefore adds **only in a test** the nine `synthetic_m03_*` tables in `tests/fixtures/m03-products-bootstrap-tenant-schema.mjs`:

- session–tenant links; Product–tenant ownership; Unit–tenant and Category–tenant links
- canonical physical stock and source-shaped stock-lot evidence
- Bundle component ownership; versioned Tile evidence with current digest
- tenant-safe Products display Settings

These are **not** numbered migrations, source-data captures or production permissions. No real Products or tenant data was read, exported or written. This private adapter must not be bound to a public Worker until M02, M03, M04, M10 and M11 approve genuine source provenance, operational tenant schema, actor authority and cutover. Do not replace real business stock with this synthetic snapshot model.

## Test-first gate and evidence

- **RED** `cbb30b7f75923b786b1ea0d19f79ea2b4bf214a1`: missing `src/db/m03-authenticated-products-bootstrap.js` verified by GitHub M04 login-to-shell job `134259656778` (`ERR_MODULE_NOT_FOUND`, 3,515 other tests passed).
- **First Workerd/D1 RED:** real M03 private catalog job `134262829317` correctly caught an invalid test fixture role epoch `0`, rejected by the actual persistent M04 D1 schema. The fixture now uses role epoch 2 vs session epoch 1; no schema was weakened.
- **Local D1 contract:** real `worker.applyD1Migrations('DB')`, then nine isolated test-only tenant/stock tables. Test role denies and session revocations before Products SELECTs; tenant A vs B, original Product IDs, real base stock, 45 Pcs → 2 Box 5 Pcs, Tile 128 Pcs → 5 Box 3 Pcs · 512.00 Sqft, Carton→Box→Pcs, signed -45 shortage, empty-config original stock fallback, Bundle availability/lot valuation, current/stale revisions, manufacturer evidence, wrong pack and old dimensions, public route 404.
- **Acceptance:** exact-final-head Node + M03 catalog Workerd/D1 + full GitHub 44-workflow CI, then independent Super QA/Super Review, no unresolved threads. A successful synthetic test is **not** approval to merge schema or enable public reads. A separate owner review/merge decision applies.

## Files and risk

**M03-owned files only:** new `src/db/m03-authenticated-products-bootstrap.js`; new `tests/m03-authenticated-products-bootstrap.test.mjs`; existing `tests/integration/m03-private-product-catalog-workerd.spec.mjs`; new `tests/fixtures/m03-products-bootstrap-tenant-schema.mjs`; this document. No M05 source code edits, no Product/UI Save enablement, no `src/rpc/registry.js`, `src/index.js`, `wrangler*.jsonc`, `migrations/**`, shared financial schema or production Worker bindings.

**Still NO-GO:** real independent Products/Unit/Tile manufacturer provenance, authenticated tenant/session binding in reviewed operational tables, source-equivalent FIFO/oversold/Bundle lot reconciliation, Product Add/Edit SQL-current CAS/idempotency, public read allowlist, 49-group original history import and M10/M11 cutover. `postingAllowed:false` from M05 is mandatory.
