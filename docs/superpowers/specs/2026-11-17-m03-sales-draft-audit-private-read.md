# M03 private SALES_DRAFT_AUDIT source read — design

**Workstream:** M03 integration #22, coordination #456; **base:** `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`; **pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Original contract and approved dependency

Frozen `Config.gs::HEADERS.SALES_DRAFT_AUDIT` has exactly eleven source headings: `Audit ID`, `Timestamp`, `Action`, `Draft ID`, `Draft No`, `Version`, `Actor ID`, `Actor Name`, `Source Owner ID`, `Invoice ID`, `Note`. `DraftSales.gs::appendSalesDraftAudit_` appends original source-shaped rows with generated unique Audit ID and action in `CREATED/UPDATED/DELETED/POSTED/POST_CLEANUP_RETRY`. The same source scans the historical Draft No column to avoid reusing numbers after deletion/posting; this reader is **not** a safe D1 Draft No issuer and does not replace that workflow. Physical `_rowIndex` is the one-based source sheet row starting at 2, not SQLite `row_id`.

Already on main, M02 owns `migrations/0008_legacy_sales_draft_audit.sql`, `src/db/sales-draft-audit-mapping.js`, `src/db/sales-draft-audit-import.js` and its isolated Workerd tests. That archive is immutable by SQL triggers, with exactly eleven mapped descriptive TEXT columns plus `legacy_sheet_row`; source `Version: 1` becomes `'1'`, `Version: '02'` remains `'02'`, timestamps retain imported text. It is distinct from active drafts, sales posting, invoices, Cash, Party or live auth.

## Alternatives and decision

- Reuse the live M06 draft-list endpoint: rejected; historic audit is append-only, confidential and not equivalent to live drafts.
- Open generic `getAllRows_` publicly: rejected; no current authenticated/tenant-scoped RPC authorization or deployable full D1 integration.
- **Selected:** a fixed-table, **private M03-only**, awaited reader with six source-compatible read methods, analogous to the reviewed `invoice-edit-audit-read.js` without a new generic abstraction.

## Interface and validation

- Export `createSalesDraftAuditReadAdapter(env)`; require a real D1 binding via existing `requireD1Binding`. Only accept exact source `SALES_DRAFT_AUDIT` and exact eleven header names for lookups. Reject invalid identifier before any SQL.
- One fixed SQL `SELECT legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note FROM legacy_sales_draft_audit ORDER BY legacy_sheet_row ASC LIMIT ?` with constant parameter 1001. Return at most 1000 complete rows, [] if truly empty, fail closed on overflow.
- Validate the exact twelve own enumerable **data** properties in each D1 row; reject accessors, prototype surprises, extra private `row_id`, missing/unsafe/fractional/gapped physical row, duplicate or blank Audit ID, blank Draft ID/No, unsupported action, version not a valid integer decimal source-text string, any non-TEXT value. Keep `'02'` and leading zeros unmodified.
- Fail closed for any D1 rejection or invalid response, with a fixed error message not exposing SQL, Actor ID/Name, Draft No, invoice, note, user credentials or input. Process all returned rows before resolving, never emit a partial history.
- `getSheetHeaders_(sheet)`: fresh original header list.
- `getAllRows_(sheet)`: original eleven fields plus `_rowIndex` in ordered source shape.
- `findRows_(sheet,column,value)`, `findFirstRow_`, `findRow_`, `findRowIndex_`: original strict `String(row[column])===String(value)`, all repeated draft events retained, first physical row returned; no generic filters, transformations or cache.
- Return only these six read methods; never writes, number reservation, HTTP routes, auth bypass, source UI change, M02 schema modification, worker/production binding or remote D1.

## Test and release boundary

- First write Node RED tests for original Config.gs eleven-column contract, full source shape, two audit events referencing same Draft ID/No, `Version='02'`, Bengali actor, whitespace notes, exact matching, cap, malformed D1, no actor/SQL leaks and no writes. The test import must fail before module exists. Commit test-only, verify **actual GitHub Foundation RED** on head.
- Implement minimal reader only after RED proof. Separate isolated local Workerd/D1 test reuses the M02 archive importer and existing test-only Worker config, tests SQL immutability, no public RPC and no production source data. The new narrow PR-only workflow is solely for this test; request M11 CI review because shared workflow ownership resides there, without changing existing global CI gates.
- Full exact-head CI, source verification, isolated Workerd and required owner review before merge. M03 parallel shared transaction readiness remains **BLOCKED**. This code is not a live draft service, billing integration, or authority to deploy.
