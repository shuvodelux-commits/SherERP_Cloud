# M03 — Source-shaped `Database.gs` catalog reads

**Scope:** Internal read-only, asynchronous source-compatible access to the two approved, non-sensitive master sheets: `PRODUCT_CATEGORIES` and `PRODUCT_UNITS`. This is a small M03 migration slice, **not** a generic Sheet or D1 writer, not an authenticated RPC implementation, and not the full M03 acceptance.

## Source evidence

Frozen original: `legacy/source/Database.gs` (pinned M00 original), `legacy/source/Config.gs` and `docs/baseline/schema-inventory.json`.

Original `Database.gs` defines:

- `getAllRows_(sheetKey)`: an array of objects whose keys are the original column headers; rows include an integer `_rowIndex`, originally physical Sheet row starting at 2
- `getSheetHeaders_(sheetKey)`: current raw/expanded column names from `CONFIG.HEADERS`
- `findRowIndex_(sheetKey,columnName,value)`: first matching physical row, or `-1`; unknown column throws
- `findRow_(...)`: first match as `{row,rowIndex}` or `null`
- `findRows_(...)`: all matches
- `findFirstRow_(...)`: first match or `null`

The original find methods use **`String(field)===String(value)`**, not fuzzy or case-folded matching. They share per-execution Sheet caches that cannot safely be ported as module-global Worker caches.

Original `Config.gs` headers are exactly:

- `PRODUCT_CATEGORIES`: `Category ID`, `Category Name`, `Status`, `Created At`
- `PRODUCT_UNITS`: `Unit ID`, `Unit Name`, `Status`, `Created At`

## M03 implementation

`src/db/legacy-catalog-read.js` exports `createLegacyCatalogReadAdapter(env)`, with the **six** underscore-named methods above, all asynchronous. It uses `requireD1Binding(env)` and a strict two-group table/column allowlist. All SQL statements are fixed SELECTs, with a **bound** max-row parameter. No SQL identifier is supplied by the caller.

The adapter maps reviewed D1 fields to original headers, converts absent optional `created_at` to the original empty string, and supplies `_rowIndex` from `legacy_sheet_row`. It rejects missing/noncontiguous row indices, malformed D1 results and datasets over **1,000** rows rather than return silently truncated or incorrectly indexed data. This explicitly assumes that the import preserved original physical row positions in these two masters.

**Intentional limitations:** Unlike original GAS, this reader has no cross-request mutable cache, does not automatically add header columns, will not create tables, and refuses unsupported sheets (including `SETTINGS`, because setting values may contain secrets). Legacy writer interfaces `appendRow_`, `appendRows_`, `updateRowFields_`, `deleteRow_` and `setSetting_` are **not implemented** in this slice. Porting the wider Database.gs and financial methods requires reviewed schemas, async callers, M04 auth and SQL-level concurrency/idempotency.

## Verification

- `tests/m03-legacy-catalog-read.test.mjs`: 6 tests using actual in-memory SQLite and a minimal async D1 boundary. TDD RED missing module was observed before GREEN; no business writes
- `tests/fixtures/m03-readonly-worker.mjs`: two extra **test-only** routes import the real adapter
- `tests/integration/m03-workerd.spec.mjs`: exercises source-shaped catalog reads, physical row IDs and strict sheet/column rejection against **real local Cloudflare workerd D1**, applying the original SQL migrations
- `.github/workflows/m03-d1-workerd.yml` already executes these integration tests on PRs with synthetic local D1, no secrets

**Unchanged:** `src/index.js`, `src/rpc/`, `wrangler.preview.jsonc`, `wrangler.staging.jsonc`, original 84-file source baseline, migrations, remote staging data, and production DNS. The deployed Worker remains DB-free and business RPCs remain 501.

## Next gates

After real-D1 CI and code review, extend source-shaped adapters only to reviewed master tables, plan authenticated M04 interfaces, then implement narrow D1 writers with DB-enforced CAS/idempotency. Do **not** emulate the original GAS `LockService` using a non-atomic JS read/write cycle; finance and inventory remain disabled.
