# M03 Tail-Only Catalog Delete — Design

**Date:** 2026-11-15
**State:** Narrow, internal M03 repository increment; NOT a general deleteRow_ port.

## Source behavior and bounded migration
The frozen source `legacy/source/Database.gs#deleteRow_(sheetKey,rowIndex)` physically deletes a Google Sheet row and shifts all lower rows up. `ProductSettings.gs` permanently deletes disabled category/unit masters; historical product records contain the label text and remain unchanged. On D1, `legacy_sheet_row` is explicit and UNIQUE; middle-row deletion needs a separately reviewed, atomic renumbering strategy. A partial middle-row delete would break the existing M03 read/append integrity gates.

**Chosen:** `createLegacyCatalogTailDeleteAdapter(env).deleteLastRow_(sheetKey,rowIndex,{sourceId,name,status})`, restricted to final physical row only, with exact source-ID/name/status compare-and-swap. This matches original row deletion for the tail case; it deliberately rejects middle-row deletion. Returns `undefined` on success, like original helper.

## Alternatives considered
- Delete any row and leave a gap: REJECTED; existing reads and appends refuse corrupt provenance.
- Delete middle row then shift in JavaScript with independent awaits: REJECTED; unsafe if worker terminates or concurrent calls interleave.
- D1 multi-statement batch compaction: DEFERRED; requires evaluated transaction integrity, uniqueness-safe renumber and fault/concurrency proofs beyond this increment.
- **Single SQL DELETE of verified final row**: CHOSEN; no compaction or multi-statement transaction needed.

## Preconditions and SQL guarantees
- Allow only `PRODUCT_CATEGORIES`, `PRODUCT_UNITS`. Fixed table/column SQL; all values are bound, no arbitrary identifiers.
- `rowIndex` physical 1-based index 2..1001, equals catalog MAX(`legacy_sheet_row`). Existing dataset 1..1000 rows, every source position nonnull and contiguous 2..N+1.
- `precondition` object exactly `{sourceId,name,status}`; nonblank strings ID/name, status string. SQL matches all three original values and requested row index atomically with DELETE.
- Stale IDs, preimage mismatch, non-tail row, missing binding, invalid input and broken row provenance reject without modification. Missing record and replay reject.
- No public API, product history writes, private SETTINGS, financial/Party/stock tables, migrations, auth or production/staging data changes.
- Node SQLite and real local Wrangler Workerd/D1 tests must verify last-row removal, no mutation on stale/non-tail, preserved row indexes, and safe subsequent append with fresh source ID.

## Limits and gates
Status `Inactive` is not a soft-delete substitute; only an actual delete of a final master row. General ProductSettings category/unit deletion, including nonfinal rows, remains blocked pending a dedicated atomic row-compaction design. M04 authentication and authorizer are required before exposing any business RPC. `PARALLEL-MODULE-READY` stays false.

**Source reference:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Database.gs`, `legacy/source/ProductSettings.gs`, `AGENTS.md`, `docs/M03_PARALLEL_READINESS.md`.
