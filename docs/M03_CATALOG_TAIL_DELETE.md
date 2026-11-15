# M03 — Guarded Tail-Only Catalog Physical Delete (internal)

**Purpose:** Add a safe, narrowly scoped physical deletion operation for the final row of the two already reviewed non-sensitive masters. This is **not** the generic legacy `deleteRow_` interface and is not a production-ready ProductSettings delete workflow.

## Original source fidelity
Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` includes `Database.gs#deleteRow_(sheetKey,rowIndex)`. Google Sheets physically removes that row and shifts following row positions; `ProductSettings.gs` calls it when the user disables a category/unit. Existing Product records store category/unit labels as text and are not modified by master removal.

D1 retains `legacy_sheet_row` as an explicit UNIQUE integer for migration parity, and both M03 source-shaped reads and master appends reject noncontiguous indices. A naïve SQL DELETE of an interior row would leave a gap and make these adapters refuse further requests. This increment therefore **only** deletes the final physical row, where no other index shifts.

## Interface
```js
await createLegacyCatalogTailDeleteAdapter(env).deleteLastRow_(
  'PRODUCT_CATEGORIES',   // or PRODUCT_UNITS only
  4,                     // original physical Sheet row (header row included)
  {sourceId:'CAT-3',name:'বাংলা',status:'Inactive'}
);
```
The `sourceId`, `name`, and `status` preimage must match the requested physical row. On success, the method resolves to `undefined`, matching the original delete helper's return shape.

## Atomic SQL guard
One fixed, parameterized `DELETE FROM ... WHERE ... RETURNING legacy_sheet_row` per master group atomically checks:
- matching immutable source ID, original 1-based physical row, name, and status;
- requested row is **the current MAX(legacy_sheet_row)**;
- all existing source rows have non-NULL contiguous row indexes 2..N+1; 1 ≤ N ≤ 1000.

A stale request, duplicate replay, wrong source identity, nonfinal row, broken provenance, invalid input or missing DB binding rejects without modification. The unique stable source IDs of all remaining rows are unchanged; after deleting the final row, a distinct new ID may be appended at the vacated physical row position.

**Security boundary:** Fixed `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` allowlist; no caller-controlled table/column SQL, no SETTINGS, no Party, stock, purchase, finance or invoice data. No public RPC, no deployed Worker imports, no production/staging D1 binding, no schema migrations, no source modifications.

## Verification and test harness
- Node `node:sqlite` tests exercise category/unit tail cases, sole-row deletion, readback and fresh-ID append, middle-row denial, stale preimage/replay, null/gapped provenance, input rejection and concurrent duplicate calls.
- Real local Wrangler Workerd/D1 tests in a **separate nondeployable Worker** with a synthetic UUID exercise the same physical operations. Test routes have fixed code-owned fixture values, ignore request JSON and never accept caller-defined identifiers.
- Existing local-only M03 GitHub Actions test entry imports the new Worker suite; PR-only CI does not require deploy credentials.

## Explicit remaining restrictions
- **Middle-row deletion/index compaction is not implemented.** It needs a reviewed D1 transaction/reindex design with correctness under UNIQUE indices, induced failure, concurrent inserts/updates, and retries.
- **ProductSettings disable/delete RPC is not implemented.** A normal product master row may be anywhere, so this helper must NOT be wired into the UI as general deletion.
- No general M03 repository, M04 authentication or M05–M08 financial module readiness claim.

**Recovery:** Revert the commit; no remote data was modified. Full M03 and `PARALLEL-MODULE-READY` gates remain open.
