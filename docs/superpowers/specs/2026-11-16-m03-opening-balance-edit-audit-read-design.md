# M03 — Opening Balance Edit Archive: Restricted D1 Source Reader

**Date:** 2026-11-16 · **Workstream:** M03 #22 · **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`

## Problem and source evidence

The original `Config.gs::HEADERS.OPENING_BALANCE_EDIT_LOG` defines **12 source columns**, in this order: `Audit ID`, `Changed At`, `Entity Type`, `Entity ID`, `Entity Name`, `Old Opening Balance`, `New Opening Balance`, `Delta`, `Current Due Before`, `Current Due After`, `Reason`, `Changed By`. `Database.gs::getAllRows_` appends physical one-based sheet `_rowIndex` beginning at 2. Source `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_` match exact `String(value)` and preserve first physical row. Duplicate entity IDs and negative/signed due values are meaningful; **Audit ID**, not Entity ID, identifies the historical edit.

M02 already merged `migrations/0010_legacy_opening_balance_edit_audit.sql`, `src/db/opening-balance-edit-audit-mapping.js` and `src/db/opening-balance-edit-audit-import.js`. The D1 table is an immutable history, not an executable ledger or current account balance. Its historical amounts are *descriptive TEXT* (original numeric Sheet values, if any, may have been stringified on import); dates are archived as text. Recalculating signed due, converting `-0.00` to `0`, grouping by entity, or interpreting this as a cash transaction would corrupt original evidence.

## Options considered

1. Add to the generic product/expense master adapter — rejected because opening-balance edit history contains confidential account and actor details.
2. Add HTTP `getOpeningBalanceEditLog` without M04 actor-specific permission — rejected because public preview must remain DB-free, sensitive history is private, and cutover has not occurred.
3. **Chosen:** one `src/db/opening-balance-edit-audit-read.js` private read-only adapter with six source-shaped helpers, a single fixed D1 SELECT, 1001 sentinel cap, full result validation, and no writes or public RPC. A narrow PR-only Workerd test will exercise real D1 without modifying existing shared M03 tests and workflows.

## Acceptance and safety boundary

- `createOpeningBalanceEditAuditReadAdapter({DB})` returns `getSheetHeaders_`, `getAllRows_`, `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_` **only** for `OPENING_BALANCE_EDIT_LOG`. Unknown sheet or original header fails before SQL.
- `getSheetHeaders_` returns a fresh array of exactly 12 original headings. `getAllRows_` returns up to 1000 entire source-shaped records (12 textual fields plus `_rowIndex`) in physical order, including repeated edits to the same entity, negative values, signed zero, blank optional amounts, Bengali names, reasons, and whitespace. Empty target is [].
- Fixed SQL: `SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?`. Parameter value exactly 1001. No user-selected table/SQL names.
- Reject unavailable/broken D1, failed query, extra/private fields (including SQLite internal `row_id`), accessor/nonenumerable columns, null/fractional/unsafe/gapped source row, 1001st row, missing/duplicate/blank Audit ID, missing Entity Type/ID, and nontext history. Sanitize errors; no partial history. Result arrays and objects must be safe plain data. No cache.
- Lookups match exact original `String(value)` semantics, keeping all historical rows for an entity and original first-match `_rowIndex`; no recomputation or Party-account conversion.
- Real isolated Workerd D1 test uses existing M02 importer against the merged immutable schema, checks archive text and duplicate entity references, D1 SQL UPDATE/DELETE triggers, zero changes on reads, 404 local fixture and 501 unregistered public RPC. A PR-only, local test workflow avoids changing the earlier M03 workflow that caused merge conflicts.
- No `src/index.js`/RPC registry changes, no original 37 HTML/GAS modifications, no migrations/importer changes, no cash/session/Party/finance/stock posting, no production/staging/remote D1, no Google Sheet mutation or production readiness claim. Source ERP stays authoritative pending explicit reviewed cutover.
- Superpowers RED-first: commit tests; verify actual GitHub Foundation failure due to absent module; commit minimal module; then verify Foundation, targeted local Workerd, current-head CI and branch conflicts. Leave owner-review PR open and do not merge on pending checks.
