# M03 — Private source-shaped DELETE_LOG D1 reader

**Date:** 2026-11-16 · **Owner:** M03-core issue #22 · **Frozen source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Context

Original `Config.gs::HEADERS.DELETE_LOG` has exactly nine headers, in physical source order: `Log ID`, `Date`, `Time`, `Module`, `Record ID`, `Invoice No`, `Reason`, `Deleted By`, `Deleted By Mobile`. Original `Database.gs::getAllRows_` appends `_rowIndex` (one-based original sheet position, first row 2). Its `findRows_`, `findRow_`, `findRowIndex_`, `findFirstRow_` compare the specified source header with `String(value)` exact equality and first physical match. Duplicate `Record ID`, `Invoice No`, deletion reason or datetime do **not** indicate a duplicate historic event; `Log ID` is the stable unique source ID. Mobile numbers are **text**; leading zeros must survive.

M02 already merged `migrations/0007_legacy_delete_log.sql`, which preserves all nine source fields as text, original Log ID and physical row index and forbids UPDATE/DELETE of imported archive records. The one-shot `src/db/delete-log-import.js` validates full offline snapshots, imports them atomically into local D1, and reads them back. No M03 reader for the imported archival history has yet been reviewed. This history may contain sensitive deletion reasons and actor mobile numbers; it must never be attached to public RPC or exposed by a test/preview Worker.

## Options and choice

- Append DELETE_LOG to the non-sensitive `legacy-catalog-read.js` master allowlist: rejected because audit records are sensitive and deserve a distinct internal boundary.
- Expose a public `getDeleteLog` RPC: rejected; original DELETE_LOG is not a user-visible generic master, requires reviewed M04 administrator/audit viewer authorization and complete business cutover.
- **Chosen:** create `src/db/delete-log-audit-read.js::createDeleteLogAuditReadAdapter({DB})`, an internal **read-only** six-helper source compatible adapter with one fixed D1 SELECT. It must fail closed on malformed or incomplete results; no new tables, imports, cash/accounting logic, or public surfaces.

## Acceptance

1. `getSheetHeaders_('DELETE_LOG')` returns exactly the original nine headers; all other sheet keys fail before DB work.
2. `getAllRows_('DELETE_LOG')` returns up to 1000 ordered original source-keyed rows including `_rowIndex`. All nine D1 fields must be text, with nonblank unique `Log ID`. No normalization of actor name, Bangla reason, phone, datetime or old reference; preserve duplicate record references.
3. Physical row indexes start at 2, must be safe integers, contiguous and complete. Missing, NULL, gapped and >1000-row results fail closed rather than misaddress historic deletion evidence or silently truncate.
4. D1 result must have exactly ten approved data fields with own enumerable data descriptors. Reject getters, unexpected private columns, invalid types and failed/throwing D1 queries; exceptions must never echo sensitive values. No stale module cache.
5. Original `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_` perform `String` exact-match on *allowlisted original source headers*, and return physical indexes. Empty history returns empty list/null/-1.
6. Real local Workerd D1 test imports a complete synthetic M02 snapshot, then reads back exact original text in M03, proves no writes, checks D1 immutable triggers, and public Worker 501/local fixture 404.
7. No changes to source repo, original 37 HTML screens, `src/index.js`, `src/rpc/registry.js`, D1 migrations, M02 importer, Party/user role semantics, live Google Sheets, staging/prod D1, auth, or deploy.
8. Use RED test-only commit and observed GitHub Foundation failure, then smallest GREEN implementation, full test suite and real Workerd integration, owner review PR. `PARALLEL-MODULE-READY=false` remains unchanged.
