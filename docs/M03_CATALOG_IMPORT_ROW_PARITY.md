# M03 — Catalog import/source row parity guard

**Status:** Local validation only. Not a live importer, API, D1 write path or production cutover.

## Reason for the guard

The original `legacy/source/Database.gs` exposes `_rowIndex` as a physical Sheet row number, beginning at 2 after the header. The reviewed M03 D1 read adapter preserves this contract for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` by reading `legacy_sheet_row` in order and failing closed on missing or uneven provenance. Previously the M02 dry-run importer accepted exports that would pass its checks but could not later be read through that M03 contract.

## Import preflight contract

`prepareCatalogImport` now checks each of the two **non-sensitive catalogs** before any migration operation:

- Every nonempty row must provide its original integer `_rowIndex`, exactly 2, 3, 4, ... in the source-array order. No missing positions, gaps, reordering or fabricated renumbering.
- Each reviewed catalog must contain at most 1,000 rows. Larger datasets are rejected instead of being silently truncated by the bounded M03 reader. A later pagination design requires an explicit new review.
- Original category/unit IDs must be present and unique; duplicate labels remain allowed; duplicated original positions remain forbidden by the existing importer checks.
- An empty catalog is valid. `SETTINGS` retains its prior dry-run behavior and must **never** be published through the unauthenticated M03 catalog reader; its values are not included in counts/errors.

The module only produces a validated in-memory import plan. It does not write D1, touch Cloudflare resources, expose RPCs, alter migrations or change Party/finance/stock semantics.

## Evidence

The test-first change added invalid-position and size-limit cases for both catalogs and confirmed that ten new negative assertions initially failed because invalid data was accepted. The same tests then passed after minimal source-only validation. Run `node --test tests/catalog-import.test.mjs`, `npm test`, `npm run verify:source`, `npm run build:frontend` and `git diff --check` to verify locally.

**Remaining M03 gates:** full async database port, source-authorized importer and reconciliation, authenticated RPC contract, financial write correctness and separate security review. This guard alone does not finish M02 or M03.
