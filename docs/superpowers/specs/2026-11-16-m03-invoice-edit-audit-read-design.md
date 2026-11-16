# M03 — Internal INVOICE_EDIT_LOG D1 history reader (design)

**2026-11-16 · M03-core issue #22 · Pinned original:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Independent of:** open PR #368 (Expense Payees offline source projection). Branch starts from current `main`.

## Evidence and scope

The frozen `Config.gs::HEADERS.INVOICE_EDIT_LOG` contains twelve fields, in order: `Log ID`, `Invoice ID`, `Edit Date`, `Reason`, `Before Grand Total`, `After Grand Total`, `Return ID`, `Before Return Amount`, `After Return Amount`, `Before Return Items JSON`, `After Return Items JSON`, `Edited By`. Original `Database.gs::getAllRows_` adds the physical one-based Sheet `_rowIndex` (data rows start at 2); `findRows_`, `findRow_`, `findRowIndex_` match source-header exact `String(value)` equality and preserve first original Sheet row. Original `SalesManagement.gs` and `SalesReturn.gs` append audit records documenting edits/returns; the history is **not a ledger movement**, and must not trigger original invoice/posting changes.

Merged M02 `0009_legacy_invoice_edit_audit.sql` and `src/db/invoice-edit-audit-import.js` already provide a private, immutable, 12-field source snapshot with `log_id`, `legacy_sheet_row` and intentionally **TEXT** amount fields and original JSON snapshot whitespace. The M02 importer normalizes finite numeric input into descriptive strings and preserves preexisting textual values; there is no evidence of whether a historic Sheet cell held a number versus a string after this conversion. This adapter will therefore expose **source-named textual archival values**, not claim perfect original runtime number types or a full replaceable GAS business writer.

## Approaches

1. **Expose invoice audit from `src/rpc/registry.js`** — rejected: unreviewed public permission/tenant binding and historical edit details could leak.
2. **Add `INVOICE_EDIT_LOG` to ordinary public-looking master `src/db/legacy-catalog-read.js`** — rejected: internal catalog supports non-sensitive static masters; invoice/return edit data is restricted financial audit evidence.
3. **Chosen:** one independent, internal-only `src/db/invoice-edit-audit-read.js` with an explicit `createInvoiceEditAuditReadAdapter(env)` allowlist for `INVOICE_EDIT_LOG`. It copies the six original read helper semantics, fixed source headers, parameterized `LIMIT 1001`, physical-row order, and exact first-match behavior. No SQL identifiers from clients, no module-level cache, no writes or public Worker import.

## Required behavior and boundaries

- `getSheetHeaders_('INVOICE_EDIT_LOG')` returns the twelve original headers in frozen order. `getAllRows_('INVOICE_EDIT_LOG')` returns up to 1000 source-keyed row objects plus `_rowIndex`, including blank fields and duplicate invoice/return IDs. The reader rejects missing, NULL, fractional, unsafe or noncontiguous physical positions; >1000 rows fail closed rather than silently truncating.
- Each D1 record must contain exactly the fixed 13 selected columns, own enumerable data fields (no gettors/proxy tricks in unit mocks), valid nonblank unique Log ID, and strings for all descriptive values. Reject malformed/failed D1 results without returning partial history or raw errors. Do not parse/normalize JSON, amounts, date text, actor, Bengali reason or whitespace, or dedupe by invoice.
- `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_` accept only twelve source header names, match `String(value)` as original, return copies and the actual one-based physical `rowIndex`. Unknown sheet/field rejected before query; empty history yields `[]`/null/-1.
- Real local Workerd/D1 proof runs the existing M02 private importer against the immutable `0009` table, then exercises source-shaped reads and zero writes, tests immutable D1 UPDATE/DELETE guards, and verifies public Worker 501 and local test Worker 404.
- No direct `src/index.js` or registry import. Any future exposing RPC must have current M04 authorized `sales.view`/audit permission and confidentiality review. This PR will **not** enable direct user access, production bindings, source-side Google Sheets edits, or cutover.
- No new migrations, Party identity links, Expense Payee D1 table, stock/Cash/Bank/finance activity, invoice edits or return posting; no frontend change, no new dependency. KISS and existing M03 local-only CI suite.
- Superpowers TDD: first commit the Node and Workerd tests; record exact RED Foundation run; implement smallest internal adapter only after RED; verify full Foundation, actual Workerd D1, public preview protection and exact-head checks. Keep draft PR pending owner review and merge. M03 production readiness remains blocked.
