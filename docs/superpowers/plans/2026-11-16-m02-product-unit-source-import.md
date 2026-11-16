# M02/M03 — Frozen Product Units Source Import into Isolated D1 (2026-11-16)

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Config.gs` PRODUCT_UNITS headers, `Database.gs` and `ProductSettings.gs`. **Target base:** `SherERP_Cloud/main@c1c33de77c5ebb0e941ef1c04aa9af746d84736f`. AGENTS.md, docs/MIGRATION_PLAN.md and ADR-007 control this work.

## 13-sentence implementation overview

1. Existing migration `0001_core_catalog.sql` already defines PRODUCT_UNITS with source IDs and optional legacy physical rows, so this change does not add SQL migrations.
2. Existing `prepareCatalogImport` only produces a dry-run; it does not persist a source snapshot.
3. This slice takes an **operator-supplied offline, synthetic/approved full PRODUCT_UNITS snapshot** whose exact source columns and physical positions are validated before writing.
4. The importer rejects missing/unexpected fields, duplicate source IDs, invalid status or values and noncontiguous row indices instead of guessing missing physical positions.
5. Source `Created At` values use the already reviewed `legacyToD1Record` serialization path and the resulting source values must match D1 readback.
6. A single D1 `batch` protects the empty-target guard and all source rows in one transaction.
7. The empty-target SQL guard deliberately fails through an existing NOT NULL constraint when unrelated D1 units already exist, so this cannot silently append another snapshot.
8. Each insert uses static SQL with bound values, stable source IDs and preserved source row positions; it never interpolates client-supplied table names.
9. An injected duplicate key or concurrent importer cannot commit a partial snapshot, and replay cannot double-import the same units.
10. After D1 commits, an awaited source-shaped readback compares every source field and row index; a mismatch becomes `NEEDS_REVIEW`, **not** a fictional rollback of committed data.
11. A real local Workerd/D1 acceptance test imports Bangla and English synthetic units, then exercises the existing stable-ID/status/row CAS update adapter against imported rows.
12. The public `src/index.js`, `src/rpc/registry.js`, Cloudflare Preview and remote staging D1 remain unchanged and unavailable for this import.
13. This demonstrates one bounded master-data integration slice only; no live source export, M04 permission, 49-group completion or M10/M11 cutover approval follows from it.

## Impact inventory and acceptance

- **New:** `src/db/product-unit-source-import.js`, internal only, no public API export from the Worker.
- **New:** `tests/integration/m02-product-unit-import-workerd.spec.mjs`, `wrangler.m02-product-units-test.jsonc`, `tests/fixtures/m02-product-units-worker.mjs` (test-only Worker, synthetic D1 UUID).
- **Minimal CI linkage:** `tests/integration/m03-workerd.spec.mjs` imports the local D1 acceptance suite; existing CI job runs it.
- **Unchanged:** all versioned migrations; original UI, source GAS, Party accounts, monetary posting, static assets and real database bindings.
- **TDD:** write failing test first and confirm RED in GitHub CI; implement smallest code; confirm GREEN in real local Workerd/D1, all repository tests and exact-head CI.
- **Fail/retry:** incomplete physical row positions, bad source ID, duplicate, pre-existing unit, two importers, late unique-constraint failure and replay must leave no unintended writes.
- **Release:** No remote Cloudflare D1 migration, no source credentials, no production export or public RPC; review/merge only on all checks green.
