# M03 — internal guarded appendRow_ for reviewed catalogs

**Status:** one isolated, internal D1 write interface with local-only tests. **Not** authenticated, not connected to a public endpoint, and not an ERP production write path.

## Frozen source behavior

The original `legacy/source/Database.gs#appendRow_(sheetKey,rowObj)` maps source-header keys into physical Sheet columns and returns the **new 1-based Sheet row index** (including the header row). Original `ProductSettings.gs` supplies category/unit IDs, names, status and creation timestamp after validating permissions/labels. Those permission-checked business services **have not** been ported.

`createLegacyCatalogAppendAdapter(env).appendRow_(sheetKey,rowObj)` supports only:
- `PRODUCT_CATEGORIES` → `product_categories` with original `Category ID`, `Category Name`, `Status`, `Created At`.
- `PRODUCT_UNITS` → `product_units` with original `Unit ID`, `Unit Name`, `Status`, `Created At`.

The caller supplies a nonblank, original **string** ID and name. Identifiers stay stable; duplicate display names are legal. The adapter refuses `_rowIndex` injection, unknown header keys, arbitrary table names, `SETTINGS`, Party, finance and transactional groups. `legacyToD1Record` owns the previously reviewed D1 text/date mapping; final timezone-parity review for `Created At` remains part of full M03.

## Guarded single-statement SQLite append

One parameterized `INSERT ... SELECT ... HAVING ... RETURNING legacy_sheet_row` per invocation atomically checks existing physical row provenance and reserves the next `legacy_sheet_row`, beginning at 2. The SQL rejects missing, gapped or null provenance, and rejects rows beyond the 1,000-row M03 read-adapter limit **without writing**. Unlike a JavaScript SELECT followed by INSERT, the row-allocation condition and insertion are one SQLite statement. Two simultaneous successful requests must get distinct physical indices; no in-memory lock or fake GAS `LockService`.

The existing unique category/unit source-ID constraints reject duplicate retries, preserving at-most-once append for one stable source ID. However a lost network response can make a successful insert **look** failed to the caller: reconcile by the original source ID before attempting any new request; never create a replacement ID and blindly retry. **This does not establish general operation-ID idempotency, a multi-record transaction or financial posting safety.**

Deleting a physical Sheets row shifts all later row indices. `deleteRow_` and `updateRowFields_` are **not** implemented here. A catalog with a gap will fail closed instead of being silently renumbered.

## Test-only Worker isolation

The deployed Worker (`src/index.js` and `wrangler.preview.jsonc`) remains DB-free with no catalog write RPC. The original `tests/fixtures/m03-readonly-worker.mjs` remains untouched. A **separate** `tests/fixtures/m03-write-worker.mjs` and `wrangler.m03-write-test.jsonc` exercise guarded appends only against a synthetic, local Wrangler D1 binding. That Worker does not accept caller-supplied sheet names, IDs or row payloads — all insert fixtures are constants in the test source. There are no real credentials, staging D1 IDs or remote writes.

The existing PR-only, no-secrets M03 GitHub Actions job already executes `tests/integration/m03-workerd.spec.mjs`; that test entry now imports the **separate** write-test suite, running both independent local Workers under the existing CI command. **No GitHub Actions workflow file or deployment permission is changed.**

## Acceptance evidence and remaining milestones

- Node `node:sqlite` tests: source rows, UTF-8, empty catalog, duplicate labels, duplicate IDs, invalid input, null/gapped provenance, 1,000 cap, concurrent inserts and malformed results.
- Actual isolated Workerd/D1 integration: concurrent source row allocation, readback parity, duplicate replay refusal, corruption refusal, and attempted external SETTINGS/ID payload ignored by the fixed local test route.
- Runtime policy: production and Preview stay DB-free; test Worker must have synthetic D1 binding and no routes/assets; PR workflow cannot deploy.

This is **one non-sensitive M03 write primitive**, not the full `Database.gs` repository. Remaining gates include authorized ProductSettings business logic, delete/update semantics, all other async module ports, full M02 import reconciliation, M04 auth and real D1 atomic financial posting/idempotency. Concurrent Inventory/POS/Finance **remain blocked** per `docs/M03_PARALLEL_READINESS.md`.
