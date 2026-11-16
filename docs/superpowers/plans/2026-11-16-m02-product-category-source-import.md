# M02/M03 — Frozen Product Categories Source Import into Isolated D1 (2026-11-16)

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `Config.gs`, `Database.gs` and `ProductSettings.gs`. **Target base:** `SherERP_Cloud/main@28e2f9de08c6977c796564f4b24d7bc170590345`. Rules: AGENTS.md, docs/MIGRATION_PLAN.md and ADR-007.

## 13-sentence overview

1. Original PRODUCT_CATEGORIES consists of Category ID, Category Name, Status and Created At, with an original physical row position supplied by an approved offline snapshot.
2. Migration `0001_core_catalog.sql` already creates `product_categories`; this increment does not need another SQL migration.
3. Existing M03 catalog read and guarded compare-and-swap update adapters work on that table, but no category full-snapshot importer is present.
4. This one-shot internal importer accepts a full offline snapshot only, without any HTTP endpoint, live source access or operator-facing auth.
5. Preflight validates only those four original headers plus `_rowIndex` and rejects accessors to prevent hostile input getters from executing.
6. Each row must have a stable nonempty Category ID/name, an explicitly supported source Status, a serializable Created At and its original consecutive physical position.
7. Duplicate names are allowed because ProductSettings.gs permits a deleted name to be recreated under a different source ID.
8. Duplicate Category IDs, extra fields, physical holes, reorderings and nonserializable values are rejected before touching D1.
9. The existing versioned schema and the exact legacy-to-D1 mapping are reused, with bound values and no client-selected SQL identifiers.
10. A SQL-level empty-target sentinel and every category INSERT execute in one D1 `batch` transaction, protecting against concurrent importers and mid-batch failures.
11. After commit, the importer awaits the existing source-shaped D1 reader and compares every original field and physical index; any mismatch is classified `NEEDS_REVIEW`, not a rollback claim.
12. A real isolated Workerd/D1 test will exercise successful import, duplicate-name preservation, concurrent replay protection, injected late SQL rollback and source-ID-guarded category update.
13. This is synthetic/offline integration evidence only, not approval to access production Sheets, migrate financial groups, enable public RPC or cut over the ERP.

## File / RPC / table impact

- New `src/db/product-category-source-import.js`: standalone importer and pure preflight for PRODUCT_CATEGORIES, no global auth or Worker route.
- New `tests/m02-product-category-import.test.mjs` and `tests/integration/m02-product-category-import-workerd.spec.mjs`: source-contract and real isolated D1 tests.
- New nondeployable `wrangler.m02-product-categories-test.jsonc` and `tests/fixtures/m02-product-categories-worker.mjs` with synthetic-only binding.
- Minimal test-only import in `tests/integration/m03-workerd.spec.mjs` to run the new suite in existing GitHub Actions.
- No changes to `migrations`, `wrangler.preview.jsonc`, `src/index.js`, `src/rpc/registry.js`, original GAS, HTML/CSS, money/stock/Party ledgers, production/staging bindings or source IDs.

## Superpowers acceptance

1. Commit the regression tests first, confirm expected RED for missing importer in exact GitHub Actions logs.
2. Implement the smallest fixed-table SQL import/validation and confirm GREEN Node tests and actual Workerd/D1 tests.
3. Show one winner under concurrent imports; fail replay or different snapshot without changing persisted data.
4. Show a trigger-failed second-row INSERT rolls back all rows; confirm source row readback and guarded update.
5. Review complete exact-head CI and security boundaries, open scoped PR, and request **owner merge only after all checks pass**. This PR never authorizes live data import.
