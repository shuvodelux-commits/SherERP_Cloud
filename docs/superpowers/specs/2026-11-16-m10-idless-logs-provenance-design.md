# M10-05 — ID-less LOGS source-position and content parity

**Tracker:** #312. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Dependencies:** merged M02 diagnostic migration `0006_legacy_error_logs.sql`, `prepareSourceLegacyErrorLogs`, `importSourceLegacyErrorLogsWithD1`; merged M10-01 through M10-04.

## Problem
The legacy `LOGS` sheet contains exactly `Timestamp`, `Context`, `Message` and has no stable source Log ID. Its entries legitimately repeat timestamps, contexts and even the entire row. D1 `row_id` is an internal surrogate and **must not** be misrepresented as legacy identity. M10 catalog `idDigest` requires actual original IDs; using it on LOGS would create a false proof.

## Solution
Add a narrow, pure `summarizeM10IdlessLogs({inventory,rows})` diagnostic comparator independent of `summarizeM10Catalog` and the 49-group M10-01 original-ID gate. Pin 49-group inventory and review `LOGS` headers through `verifyLegacyErrorLogMapping`. Reuse M02's `prepareSourceLegacyErrorLogs` for exact source-shaped rows, Date-to-UTC conversion and monotonic `_rowIndex`, without copying or changing M02 importer code.

Return exactly `{sheetKey:'LOGS',rowCount,rowDigest,positionDigest,identityKind:'SOURCE_ROW_POSITION_ONLY'}`. Hash `JSON.stringify(['M10-LOGS-ROW-v1','LOGS',[[physicalRow,timestamp,context,message],...]])` and independently `JSON.stringify(['M10-LOGS-POSITION-v1','LOGS',[physicalRow,...]])` using SHA-256 lowercase hex; no filenames/IDs/contents/hashes logged. `positionDigest` is **provenance only**, not an `idDigest`, and cannot fulfill original-ID proof or count as complete 49-group reconciliation. Source snapshot completeness must be checked against independent rowCount/source-freeze evidence; a truncated but internally valid suffix is not an invalid input in isolation, just a *different digest and count*.

Run real isolated Workerd/D1 tests using existing M02 log importer, a fixed SQL SELECT for `legacy_sheet_row,timestamp_text,context,message`, projecting back to exact original three source fields. Compare source and real D1 digest summaries, then mutate stored message, mutate stored row position preserving validity, and remove a row to prove row-count detection; allow duplicate full messages. Confirm test-only Worker has no HTTP import/RPC route.

## Non-goals and safety
No new D1 schema or writer, shared repository edits, public Worker binding, frontend, auth/financial posting, GAS/Sheets export or production remote import. Never normalize diagnostic strings (could include secrets) or print digest bytes in CI. Wrong input throws one fixed `M10 LOGS evidence invalid` error. Do not promise that LOGS (a mutable append-only sheet with no row ID) can ever prove stable identity across reorder/deletion without separately approved source-change evidence. The M10-01 original-ID gate remains **unmodified** with `authorizesImport=false` and `productionReady=false`.

### Approaches considered
1. **Selected:** separate row-position provenance evidence, explicitly not source identity.
2. Put fake `idDigest` into existing catalog function — rejected; invents source Log ID.
3. Skip LOGS entirely — leaves a reviewed, working local importer without independent D1 parity evidence.

### Acceptance
Unit tests for deterministic hash, duplicate full messages, Unicode/whitespace, timestamp Date, row-order/position, missing/invalid/accessor rows and immutability. Actual Workerd/D1 import + queried readback, content/position mutation and source-row deletion; CI RED→GREEN. Owner reviews draft PR. Full private 49-group, financial, performance, security and restore gates remain blocking.
