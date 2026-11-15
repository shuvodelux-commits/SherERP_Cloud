# M03 — Guarded Source-Identified Catalog Updates

**Status:** Narrow internal M03 preparation slice. Not a complete `Database.gs` port and not enabled for public RPC, ProductSettings business methods, staging or production.

## Original source and reason for stricter D1 contract
The pinned legacy source is `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (original `legacy/source/Database.gs` and `legacy/source/ProductSettings.gs`). GAS `updateRowFields_(sheetKey,rowIndex,fields)` patches one or more physical Sheet columns and returns `undefined`. After a physical sheet delete, row numbers may shift; D1 uses immutable source IDs and imported `legacy_sheet_row` instead.

The migration intentionally **does not expose a drop-in three-argument variant**. A row number alone is insufficient to prove which logical record is being changed. The new interface is:

```js
await createGuardedCatalogUpdateAdapter(env).updateRowFields_(
  sheetKey,
  rowIndex,
  fields,
  {sourceId, name, status}  // mandatory exact previously-read source values
);
```

This interface is internal, requires a reviewed module-level integration, and is not safe to wire to public RPC before M04 server authentication and permission checks.

## Guarantees and explicit limits
- `sheetKey` is a fixed allowlist: `PRODUCT_CATEGORIES` or `PRODUCT_UNITS` only. No dynamic SQL table/column names.
- `rowIndex` is a physical row between 2 and 1001 inclusive; original source IDs are immutable. Only original `Category Name` / `Unit Name` and `Status` can be updated. `Status` changes limited to exactly `Active` or `Inactive`; blank names, unknown columns, `Created At`, IDs and `_rowIndex` edits rejected.
- One fixed, parameterized SQLite `UPDATE ... RETURNING` verifies the source ID, physical row position and exact preimage name/status, **within the same write statement**. A concurrent edit to either preimage makes the stale request fail instead of overwriting the other request.
- The same SQL also rejects inconsistent source-row provenance (NULL/physical gaps) or datasets larger than 1000. It updates only selected fields, leaving ID, date and other records unchanged. Success returns `undefined` as in the GAS helper.
- This is a per-row optimistic-concurrency safeguard for **nonfinancial master labels**, not general operation-ID idempotency, audit posting, transaction reversal or a financial source of truth. No retry with invented identities. There is no JS SELECT/UPDATE race or simulated `LockService`.
- A status change to `Inactive` here is a low-level test of bounded update semantics, **not** a replacement for original `ProductSettings.gs` deletion workflows. The original module permanently deletes disabled categories/units; implementing that requires a separate reviewed, authenticated business operation.

## Files / ownership / recovery
- New `src/db/legacy-catalog-update.js`, `tests/m03-legacy-catalog-update.test.mjs`.
- New nondeployable Worker `tests/fixtures/m03-update-worker.mjs` and `wrangler.m03-update-test.jsonc` with **synthetic** local-only D1 UUID.
- New `tests/integration/m03-catalog-update-workerd.spec.mjs`, imported from the existing CI entry `tests/integration/m03-workerd.spec.mjs`.
- This branch does **not** modify PR #33's `src/db/legacy-catalog-append.js`, append fixture, existing migrations, `src/index.js`, `src/rpc`, preview/staging configs or the immutable original source snapshot.
- SQL table impact is limited to isolated tests of `product_categories` and `product_units`. No actual remote D1 write, no import/backfill and no production data touched. Cash/Bank, Party accounts, stock, invoice, ledger, POS, purchase, reverse posting: **zero impact**.
- Recovery is reverting the isolated commit; no remote rollback or cutover operation necessary.

## Verification
TDD RED: new focused Node SQLite tests fail on a deliberately empty adapter; GREEN proves precise update, UTF-8 name, stale name/status rejection, wrong-ID/position rejection, provenance checks and concurrent compare-and-swap.

Real local Workerd/D1 RED: fixed routes absent (404); GREEN verifies optimistic concurrency, duplicate retry refusal, malformed requests and source row data. CI uses the combined existing local-only M03 Workerd entry, with no workflow/deploy change.

**Still blocked:** M03 general async conversion and updates, M04 durable authenticated sessions/RBAC, M02 complete import/reconciliation, shared posting kernel, and parallel financial module writes. `PARALLEL-MODULE-READY` remains false.
