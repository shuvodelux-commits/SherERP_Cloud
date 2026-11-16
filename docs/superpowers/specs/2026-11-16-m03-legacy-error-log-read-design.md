# M03 — LOGS private, source-shaped D1 read (design)

**Date:** 2026-11-16 · **Workstream:** M03-core issue #22 · **Frozen source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` · **Independent of:** open M03 #382/#385.

## Original contract

`Config.gs::HEADERS.LOGS` specifies **three** fields in order: `Timestamp`, `Context`, `Message`. Original `Database.gs::getAllRows_('LOGS')` serializes cells, returns original physical `_rowIndex` beginning at 2. `findRows_`, `findFirstRow_`, `findRow_`, and `findRowIndex_` compare `String(value)` exactly and return first physical match. `Utils.gs::logError_` appends an error event containing a Date timestamp, source context and message. **The original LOGS sheet has no Log ID**. Identical timestamps, contexts and messages are allowed as independent events and must not be deduplicated or assigned invented source identity.

M02 already merged `migrations/0006_legacy_error_logs.sql`, `src/db/legacy-error-log-mapping.js` and the one-shot atomic `src/db/legacy-error-log-import.js`, with actual synthetic local Workerd D1 tests. The table has private `row_id` internal to SQLite and source physical `legacy_sheet_row`; the row ID must never be projected to a source row. Timestamp strings are post-M02 archival representations; a native source Date object can no longer be reconstructed reliably, so the reader returns textual `Timestamp`.

## Options

1. Add LOGS to ordinary master `legacy-catalog-read.js` allowlist: rejected because error messages may contain confidential information.
2. Build an exposed HTTP/RPC log viewer: rejected; staff permission and privacy review are not complete, and public DB-free previews are required.
3. **Chosen:** `src/db/legacy-error-log-read.js::createLegacyErrorLogReadAdapter({DB})`, a separate private read-only module exposing six familiar async original read helper names for the exact `LOGS` source group. Fixed SELECT, bound 1001 cap, full strict result/provenance validation and no writes.

## Acceptance

- `getSheetHeaders_('LOGS')` returns exactly three source headers; unknown group/header fails before SQL.
- `getAllRows_('LOGS')` returns up to 1000 rows with exactly `Timestamp,Context,Message,_rowIndex` and contiguous `_rowIndex` starting at 2. Preserve Unicode, whitespace, blank timestamps, complete duplicate events, and source physical order. Empty archive yields [].
- D1 SQL is a single literal `SELECT legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row ASC LIMIT ?`. Reject >1000 rows, missing/gapped/NULL/unsafe physical source positions, invalid D1 query result, null/non-string historical values, own-property getter, extra internal/private columns or unavailable D1. Refuse partial reads and sanitize errors; never leak internal `row_id` or exceptions.
- `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_` use exact source header allowlist and original String comparison, first original physical match; do not generate a `Log ID`.
- Run Node unit tests and an isolated real Workerd/D1 M02 import→M03 readback proof, plus assert public Worker returns 501 and local fixture 404. A dedicated PR-only isolated workflow (one local Workerd test) avoids editing the currently open #382 workflow and #385 aggregator and avoids running their entire heavy suite.
- No schema/import M02 changes, original UI/GAS edits, M04 authentication bypass, deployed Worker, production/staging D1, live business data, Party identity, cash/bank/financial postings, new dependencies, or source log writes. Never claim full M03 completion or deploy approval.
- Superpowers: test-only RED commit and observed CI failure → minimal implementation → Foundation + real Workerd green → owner reviews PR and merges. All changes in GitHub only.
