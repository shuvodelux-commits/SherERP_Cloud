# M02 — 0012 isolated product-source snapshot archives

Authority: frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 PRODUCTS (19 columns) and separately approved feature reference sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c (24 product columns, 12 conversion columns).
Predecessors: merged PR #402, #407 and #313. Tracks M02 in docs/WORKSTREAMS.md and issue #314. GitHub branches/PRs, test-first RED → GREEN, KISS.

## 13-sentence implementation overview

1. The next migration is numbered 0012 and adds isolated historical product-source snapshots.
2. The canonical frozen Mohim_ERP PRODUCTS sheet has nineteen columns and remains the only primary business-source profile.
3. A separate older feature implementation defines twenty-four product columns and twelve conversion columns that are not automatically treated as canonical history.
4. Original Product IDs remain scoped to the exact source profile, so duplicate IDs across the two repos do not imply the same underlying inventory item.
5. Barcode, names and phone-like text are never used for identity merging.
6. The SQLite STRICT product archive records the physical sheet row and every profile-specific source field as text.
7. The optional conversion archive also retains original Conversion IDs, physical positions, unit factors, unit price strings and an explicit supplementary-product-only foreign key.
8. Canonical rows cannot silently grow supplementary fields and supplementary rows cannot forge newer canonical Product Type and Bundle Revision.
9. SQL uniqueness and immutable UPDATE/DELETE triggers prevent duplicate imports or alteration of historical snapshot evidence.
10. A bounded internal import uses the reviewed source contract, parameterized D1 batch, an empty-target SQL guard and exact postcommit row-by-row readback.
11. Failed late conversion inserts, duplicate submissions and concurrent conflicting imports must never leave partially imported products.
12. The migration adds no active product writer, unit conversion backfill, posting change, public RPC, preview D1 binding, or remote Cloudflare operation.
13. Independent Node and real isolated Workerd/D1 tests must pass before this PR is considered mergeable, and actual business-data migration still requires separately approved encrypted export, backup, reconciliation and cutover.

## Superpowers RED → GREEN steps
- RED: commit Node contract/SQLite tests and isolated D1 integration test first; verify expected missing migration/module failure in GitHub CI before coding implementation.
- GREEN: versioned 0012 migration + narrow source-to-D1 mapper/importer, no production consumer.
- Guard source headers against pinned inventory and older reviewed Config.gs; no arithmetic on imported financial text.
- Cover strict constraints, source-profile isolation, conversion FK, origin row ordering, rollback under late failure, readback, replay and immutability using actual local Workerd/D1.
- Update exact migration-count gates and partial 49-group classification; maintain 0 fully reconciled live business groups.
- Run npm test, npm run verify:source, npm run build:frontend, local D1 migration proof, GitHub CI and review against fresh main before merge.

## Files, contracts, and safety
- Create migrations/0012_legacy_product_snapshots.sql; src/db/product-d1-snapshot-import.js; new tests/fixture/isolated Wrangler CI.
- Update scripts/audit-migration-coverage.mjs and its tests, scripts/local-d1-schema-check.mjs and its tests, staging local-only schema workflow, and source-coverage note as needed.
- All existing serverCall/RPC contracts unchanged. No Google Sheets contents imported and no imported snapshots serve POS, stock, finance, purchases or reports.
- Never infer supplementary-to-canonical product identity by matching ID, barcode, name, or unit; any eventual linkage requires an explicit human-approved provenance mapping.
- This is a one-shot **isolated synthetic snapshot**, not a production-candidate authoritative PRODUCTS schema. Live product writes and complete 49-group reconciliation are future gated work.
