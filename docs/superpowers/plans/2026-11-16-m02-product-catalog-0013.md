# M02-13 — D1 operational product catalog schema, versioned unit configuration (inert)

**Sources:** frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 `Config.gs`, `Products.gs`, `ProductSettings.gs` and separately approved sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c `ProductUnitConversions.gs`.
**Predecessors:** verified merged #413 (migration 0012), #407 (19 vs 24/12 source profiles), #313 (pure mixed-unit math). **Issue:** #314.
**Delivery rules:** GitHub-only, scoped PR, TDD RED→GREEN, KISS; real local Workerd/D1. No local PC work, remote D1, live import, production RPC or Cash/Stock posting.

## 13-sentence overview

1. Migration 0013 introduces an inert operational product catalog schema alongside the immutable 0012 source archives.
2. Existing canonical Product IDs must be preserved and linked to reviewed canonical source-row provenance, never matched by name, barcode or coincident older-repo IDs.
3. Newly created products need their own identity and must not claim historical-source provenance.
4. Base-stock units remain plain-text labels because the original ProductSettings.gs allows a Unit master row to be deleted and its name reused without rewriting existing products.
5. Verified Unit master IDs may be referenced when available, but deleting an old Unit master must clear only the optional reference, preserving the historical unit label.
6. The product's base-stock dimension is sealed against unreviewed changes because FIFO and cost history cannot be silently reinterpreted.
7. Purchase prices, sale prices and stock baselines are retained as text in this DDL-only slice rather than recalculated with SQLite floating-point arithmetic.
8. A product has a current unit-configuration revision number that defaults to zero until an authorized writer activates a complete version.
9. Each product unit profile records independently chosen purchase/selling price anchors, stock-view unit and stock-unit price overrides for a single immutable revision.
10. Each revision's conversion rows retain conversion IDs, unit names, flattened factor text, natural-chain relation text, independent purchase/selling price overrides and active/inactive status without rewriting earlier revisions.
11. SQL constraints, foreign keys and immutability triggers reject duplicate units within one revision, orphan profiles, deletion of historical configurations and switching to an absent or mismatched revision.
12. Node SQLite and isolated real Workerd/D1 tests will demonstrate these boundaries, optional Unit deletion behavior, atomic fixture failure and no public worker routes.
13. M03/M04 authorized creation, revisions and exact decimal/chain validation, M05/M06 postings, M07 reversals, and live data cutover remain future separately reviewed tasks—not enabled by a schema migration.

## RED → GREEN

- First commit: plan, SQLite acceptance tests and isolated Workerd/D1 integration tests asserting missing migration 0013, constraints, source lineage, zero-revision fallback, immutable revisions and post-failure rollback. Confirm expected failing GitHub run.
- Second commit: minimal additive SQL migration 0013; no data seeds, updater, client route or financial writer.
- Update exact migration inventory, local D1 schema proof and current source-coverage text; classify PRODUCTS as source archive + inactive candidate catalog, never fully reconciled.
- Run `npm test`, source verification, frontend build, isolated real D1 integration and complete exact-head PR CI. Identify genuinely failing tests rather than hiding them.
- No automatic merge until all exact-head checks pass and owner reviews.

## Tables and interface impact

- New `products`, `product_unit_profiles`, `product_unit_conversions` only. The original `legacy_product_snapshots`/supplementary archive remain immutable, independent evidence.
- `products.source_profile=canonical` demands exact canonical snapshot product ID and physical row, while `source_profile=new` has no fabricated legacy row/ID.
- SQL stores user-provided human unit labels and optional foreign keys to existing `product_units`; `ON DELETE SET NULL` does not remove the existing label.
- Versioned unit profiles/conversions are append-only; changing current revision is only a future authenticated transaction operation, not a public feature in this PR.
- No changes to existing `serverCall` RPC signatures, original UI DOM, inventory FIFO, bundles, payments, Party or journals.
- Full import and reconciliation of private Google Sheets requires separate backup and owner approval before any remote migration.
