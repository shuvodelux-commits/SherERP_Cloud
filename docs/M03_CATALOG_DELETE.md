# M03 — guarded permanent catalog deletion and Sheet-row compaction

**Source:** original, pinned `legacy/source/Database.gs#deleteRow_` and `legacy/source/ProductSettings.gs#setProductCategoryStatus/setProductUnitStatus`. GAS `deleteRow_(sheetKey,rowIndex)` permanently deletes a row, shifts following rows' 1-based physical Sheet indexes up by one, and drops cached rows. Category/Unit labels saved in original PRODUCTS records stay as plain text after the master row is deleted.

**Implementation:** `src/db/legacy-catalog-delete.js` exports `createGuardedCatalogDeleteAdapter(env).deleteRow_(sheetKey,rowIndex,{sourceId,name,status})`. The additional stable source ID/name/status preconditions are a deliberate security and concurrency hardening over the GAS row-index-only call. This is **not** a general Sheet writer. Only `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` are allowed; SETTINGS, Party, Sales, Returns, Finance and Stock are forbidden.

The adapter executes a fixed three-statement `D1Database.batch` transaction, using exclusively fixed allowlisted SQL identifiers and bound external values:

1. `DELETE ... WHERE legacy_sheet_row=? AND source_id=? AND name=? AND status=?` and a full contiguous-row source provenance check (2..N+1, N≤1000), `RETURNING legacy_sheet_row`.
2. Only when SQLite `changes()=1` from the deletion, temporarily move following rows' `legacy_sheet_row` indexes above 1002.
3. Only when the second phase moved rows, subtract 1003, giving original index −1 without colliding with the D1 UNIQUE source row constraint.

**Atomicity:** A failure in phase 2 or 3 rolls back the first deletion. Real local Workerd/D1 tests deliberately create a trigger to abort the row-shift phase, then verify the deleted record and all source indexes remain unchanged. A stale/replayed ID or source row position causes no deletion or shifting; the method rejects rather than reporting a silent success. If an external call's result is uncertain, reconcile by stable source ID; do not blindly retry with a different ID or preimage.

**Boundary:** This is an internal repository primitive **without** server-side `products.edit` permission enforcement; do not expose it in any production RPC until M04 authenticated authorization and approved ProductSettings behavior is integrated. It is exercised only through a test-only Worker with fixed synthetic input and a fake D1 binding UUID. No public Worker, migrations, original source, GitHub Actions workflow, Cloudflare config, real data, or financial table is changed. Existing catalog append, batch append, activation and field update adapters remain unchanged.

**Tests:** Node SQLite fixture exercises deleting first/middle/last row and empty catalog, concurrent same-ID attempts, replay, wrong ID/preimage/index, source gap/NULL, forbidden tables, missing D1 transaction binding, and rollback on a forced mid-batch SQL error. Actual Workerd/D1 exercises source row compaction and duplicate replay, forced atomic rollback, unit last-row deletion, and zero settings writes. Existing PR-only CI imports this test suite via the original M03 integration entrypoint.

**Still blocked:** Full M03 async conversion, M02 source-import parity, M04 D1-backed sessions and role check, financial posting transaction kernel, and M05–M08 integrated inventory/POS/accounting. This does **not** establish sale, stock or ledger posting safety or readiness for simultaneous transactional-module development.
