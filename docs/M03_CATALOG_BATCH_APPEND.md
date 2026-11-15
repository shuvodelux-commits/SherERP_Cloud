# M03 — Atomic source-shaped catalog appendRows_ (internal only)

**Scope:** One incremental M03 asynchronous D1 helper for the two already-reviewed non-sensitive master groups. It is **not** a general import, purchase/sale/ledger writer, public RPC or production-enabled feature.

## Original source contract
- Original `legacy/source/Database.gs#appendRows_(sheetKey,rowObjs)` performs one batched Sheet write, maps original headers, and returns `undefined` (including an empty/zero-length input).
- Original behavior covers arbitrary sheets; the migration deliberately restricts to `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` until authorized schemas and module-level permissions exist.
- Source pinned: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen `legacy/source/Database.gs` blob `cd09275de5da55fbcdb6f84a17b3a581edc9498e`.
- Original category and unit source headers: ID, Name, Status, Created At. Source ID never regenerated. Identical labels with distinct IDs are valid.

## D1 guard and atomicity
`createLegacyCatalogAppendAdapter(env).appendRows_(sheetKey,rowObjs)` validates the entire batch via the shared `legacyToD1Record` mapping and strict string ID/name checks. Unknown sheets, unsafe headers, nonarrays, caller-supplied `_rowIndex`, and more than 1,000 rows are refused before SQL. An empty batch returns immediately.

The whole batch is written by **one parameterized SQLite `INSERT INTO ... SELECT ... FROM json_each(?)` statement**, not a sequence of individual inserts. A read-only aggregate over the destination table guards (1) contiguous original source row positions starting at 2, (2) nonnull provenance, and (3) total size no larger than 1,000. The insertion allocates `legacy_sheet_row` in the input array order, and returns `undefined` on success.

The existing `UNIQUE` original ID constraints prevent duplicates within a batch, duplicates against existing rows, and ambiguous replay. If any row violates a constraint, **the entire SQLite statement aborts**, so no earlier sibling is committed. A failed provenance/capacity condition selects zero rows and is rejected. There is no JS-side SELECT-then-write gap, module-level cache, fake LockService or user-controlled SQL identifier.

A lost network response can still leave a successfully committed batch whose caller perceives failure; clients must reconcile stable source IDs before deciding whether to retry. This primitive is **not** multi-table accounting operation-ID idempotency.

## Files and boundaries
- `src/db/legacy-catalog-append.js`: batch method and fixed SQL, sharing source-row validation with the existing single-row writer.
- `tests/m03-legacy-catalog-batch.test.mjs`: isolated Node SQLite RED/GREEN cases.
- `tests/fixtures/m03-write-worker.mjs`: fixed synthetic batch POST routes **only in the nondeployable test Worker**, never in `src/index.js`.
- `tests/integration/m03-catalog-append-workerd.spec.mjs`: real local Workerd/D1 batch order, duplicate replay and rollback tests.
- SQL migration and tables **unchanged**: `product_categories`, `product_units`. `SETTINGS`, stock, Party accounts, Cash/Bank, ledger and sales tables untouched.
- No production or staging D1 access, no authentication bypass, no public `/api/rpc` change, no frontend change and no legacy source file modification.
- Revert this PR to recover; no live backfill, financial reconciliation or remote database rollback required.

## Verification and remaining gates
- Test-driven development: focused Node tests first failed because `appendRows_` was absent; real Workerd test first failed with missing test-only route.
- Node SQLite and actual local Wrangler Workerd/D1 integration are required to pass before merge; log exact current counts in the PR.
- M03 async port, catalog delete/update, M04 authenticated permissions, M02 whole-schema import and real financial concurrency/idempotency remain future work. **PARALLEL-MODULE-READY is false** under `docs/M03_PARALLEL_READINESS.md`.
