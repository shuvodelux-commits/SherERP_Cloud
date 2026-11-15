# M03 — Guarded Catalog Reactivation (internal-only)

**Source:** Original `legacy/source/ProductSettings.gs` methods `setProductCategoryStatus` and `setProductUnitStatus`, supported by `Database.gs#updateRowFields_`. The original source sets an existing category/unit's `Status` to the exact string `Active` when requested; non-`Active` status requests **permanently delete the master row** instead of marking it inactive.

## Implemented subset

`createLegacyCatalogActivationAdapter(env).activate_(sheetKey,rowIndex,expectedSourceId,expectedStatus)`

- `sheetKey` is **only** `PRODUCT_CATEGORIES` or `PRODUCT_UNITS`. `SETTINGS`, Products, Party, Cash, finance and transaction tables are forbidden.
- `rowIndex` is a 1-based physical Google Sheet row including header offset, between 2 and 1001.
- `expectedSourceId` must match the original category/unit stable ID.
- `expectedStatus` is the status observed before a proposed reactivation; on successful matching update the stored status is exactly `Active`.
- Returns the same physical `rowIndex` after a successful, awaited D1 statement. Missing, changed or corrupt source rows reject with an error, never a silent success.

The SQL is a fixed, allowlisted `UPDATE ... SET status='Active' WHERE legacy_sheet_row=? AND source_id=? AND status=? AND (SELECT catalog_integrity_predicate) RETURNING legacy_sheet_row` per catalog table. SQLite evaluates identity/status/provenance in the **same statement as the write**, avoiding stale JavaScript read-before-write authority. Catalog integrity requires all rows to have contiguous sheet indices 2..N+1 and the existing 1,000-row bounded-read limit. A lost/unknown response must be reconciled against the original source ID and current status; no blind retry with changed expected status.

This additional precondition is stricter than the old `updateRowFields_(sheetKey,rowIndex,fields)` signature, intentionally preventing a shifted physical row from being updated based solely on stale position. **This is not a drop-in migration of the general helper.**

## Exclusions and integration gate

This does **not** implement the original permanent delete/row compaction when `status !== 'Active'`, and does not migrate arbitrary field edits, access control or complete ProductSettings. The method has **no production API route**: it is not imported from `src/index.js`, not registered in `src/rpc/**`, and neither Cloudflare preview nor staging/production D1 configurations have been changed.

Local synthetic Workerd fixture `tests/fixtures/m03-write-worker.mjs` offers only fixed, hard-coded activation test actions and ignores any client-supplied JSON fields. It shares the already isolated `wrangler.m03-write-test.jsonc` with synthetic D1 UUID. The existing PR-only, secret-free GitHub Actions runner executes it via `tests/integration/m03-workerd.spec.mjs`; **no workflow changes**.

## Verification

- Node/SQLite unit tests cover both catalogs, exact ID/index/status CAS, competing stale attempts, malformed input, source-row gaps and NULLs, >1000 rows, missing binding, and invalid D1 return types.
- Actual local workerd+D1 test covers two competing activations (one succeeds), stale retry rejection, corrupt source provenance, category/unit readback, and zero Settings mutations.
- No original source, schema migration, finance posting, public routes or frontend files are edited.

**Outstanding:** Full M03 async call graph, source-compatible deletion/index compaction, reviewed M02 imports, M04 authenticated `products.edit` role check, and durable financial transaction posting. See `docs/M03_PARALLEL_READINESS.md`. These gates keep parallel transactional module implementation blocked.
