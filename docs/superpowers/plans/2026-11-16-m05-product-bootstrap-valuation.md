# M05 — Products master bootstrap stock valuation and bundle read parity (2026-11-16)

**Frozen business authority:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Products.gs::getProductsBootstrap` and `Bundles.gs::{bundleProductType_,bundleProductMap_,validateBundleDefinition_,getBundleDefinitions_,getStoredBundleDefinition_,getBundleAvailability_}`. **Target:** `shuvodelux-commits/SherERP_Cloud` fresh main. Follow `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md` and `docs/architecture/ADR-007-unified-party-relationships.md`.

## Thirteen-sentence overview

1. The original Products page calls `getProductsBootstrap`, a different read model from the M09 Stock Report, and requires the original UI field names.
2. Products include activeRows(PRODUCTS), meaning non-soft-deleted rows, including products whose Status is Inactive.
3. A Standard product with no STOCK_LOTS row uses Current Stock multiplied by its stored Purchase Price, including negative stock.
4. For products with lots, the source initially sums all lot remaining quantities times their purchase costs, including historical rows whose Status may be Deleted.
5. The source deliberately retains a genuine free purchase's zero cost and never substitutes the current product price for its zero-cost lot.
6. Zero-cost internal OPENING, OPENING-MIGRATION, ADJUSTMENT, LEGACY and prefixed OPENING-/ADJUSTMENT- lots are unpriced data requiring a display-only product-cost fallback when total lot quantity does not exceed current stock.
7. The same fallback fills a positive gap between Current Stock and lot Remaining Quantity, but must not hide a source mismatch when lot quantity exceeds Current Stock.
8. Bundle products are not physical stock: they display Stock Value zero, their current recipe components or last stored revision after validation failure, an error string, and available sets based on component stocks.
9. Bundle recipes can only include distinct, existing, active Standard products with valid strictly positive quantities, following the frozen source validation error messages and fallback behavior.
10. Category and Unit options exclude only exact Status Inactive, while Settings Currency Symbol and Low Stock Threshold preserve the original fallback behavior.
11. The internal projector will consume only explicitly trusted tenant-scoped source-shaped product, lot, category, unit, bundle recipe and settings snapshots, reject ambiguous original IDs, and perform no authorization or I/O.
12. Test-first Superpowers execution must verify a real missing-module RED failure in GitHub Actions, then compare the full GREEN response to the original extracted GAS functions inside a synthetic VM with complete repository CI.
13. No original GAS/Sheets, live D1, M02 schema, M03 atomic posting kernel, M04 auth, M06 POS, M07 returns, M09 report implementation, public RPC, static frontend or production bindings are changed.

## Scope, parity and rollback

- Add exactly three new files: this plan, `tests/m05-product-bootstrap-valuation.test.mjs` and `src/modules/m05-product-bootstrap-valuation.js`.
- Public function `projectProductsBootstrap({productRows,stockLots,bundleComponentRows,categoryRows,unitRows,settings})` returns frozen `getProductsBootstrap.data` shape: `{products,categories,units,currencySymbol,lowStockThreshold}`, preserving per-product `Stock Value`, `Unpriced Lot Count`, `Unpriced Remaining Quantity`, `Bundle Components`, `Bundle Error`, `Available Sets`.
- There is no live D1 collection, no SQL execution, no update or creation, no source repair, no cash/bank/Party posting, no RPC registration or front-end wiring. Future M04/M03 caller **must enforce products.view before acquiring any tenant-scoped snapshots** and separately implement source-backed async repository reads.
- Deliberate fail-closed migration checks (beyond source's permissive first-match semantics): duplicate/missing original product, lot, category, unit and recipe-row source IDs when supplied; accessor-bearing records and unsafe nonfinite numeric lot/product values. Invalid bundle component business definitions are still reported as original `Bundle Error` with stored recipe fallback, not silently hidden.
- Keep bundle components and quantities in their original source units; multi-unit feature PR #313 remains separate and must be integrated only after its reviewed conversion schema is ready. No stock posting is inferred from display valuation.
- Test positive free-cost purchase, internal opening/adjustment zero-cost gap, above-stock lot mismatch, fallback with no lot and negative stock, deleted row inclusion, active/inactive selectors, valid and invalid bundles, source numeric defaults, snapshot immutability and public-RPC absence.
- Source oracle extracts the named function declarations with Acorn; no live Sheets, production D1, staff tokens or data are required.
- Rollback: revert the three new files with zero persistent business effects.
- Remaining release gates: M02 Products, Stock Lots, Bundle components and Multi Units D1 schemas; M03 tenant-scoped readers and DB-enforced stock-posting idempotency; M04 products.view; original UI parity; M10 business-data import checks. This pure read parity is **not** a functioning production ERP.
