# M03 INVOICE_EDIT_LOG Source-Header D1 Reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. GitHub-first, test-only RED proof, minimal GREEN, exact-head full Node and actual local Workerd/D1 integration, draft PR owner merge.

**Goal:** Make previously M02-imported, immutable legacy invoice edit audit history internally readable in the original 12 source-header row format, preserving original physical provenance and textual snapshots.

**Architecture:** Create a single restricted `src/db/invoice-edit-audit-read.js` adapter. It exposes six familiar read helpers only for `INVOICE_EDIT_LOG`; it uses fixed SQL selection, deterministic source-header projection, no writes, no caching and strict malformed-source denial. The already merged M02 importer and D1 table are the one canonical data source.

**Tech Stack:** Node 22 ESM `node:test`, `node:sqlite`, Wrangler 4.161.0 local Workerd+D1.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-invoice-edit-audit-read-design.md`.

## Global constraints

- Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; original twelve `INVOICE_EDIT_LOG` headings and one-based physical Sheet row indices.
- M02 `migrations/0009_legacy_invoice_edit_audit.sql` and `src/db/invoice-edit-audit-import.js` already merged; **do not modify** schema/import or infer numeric historical cell types from descriptive M02 TEXT.
- No public RPC registration, `src/index.js`, original UI/HTML/GAS, production D1, live data import, accounting movements, staging writes, refactors, added dependencies, or collision with open M03 Payee PR #368.
- Only M03-owned internal module and PR-only tests/workflow, no external actor or user-controlled identifier interpolated into SQL.

## 14-sentence overview

1. Original Sales Management appends records to INVOICE_EDIT_LOG after an invoice edit.
2. Original Sales Return changes also append this audit evidence.
3. The source history has twelve named columns and one-based physical Sheet row provenance.
4. Multiple audit records may reference one invoice or return.
5. M02 has already created the immutable D1 archive and a one-shot offline importer.
6. Its historical numeric values are stored as source-descriptive text.
7. The missing M03 piece is a bounded, awaited archive reader with original source headings.
8. The reader must preserve JSON strings, whitespace, Bengali reasons, IDs, actor and date text.
9. It must not deduplicate records or recompute financial balances.
10. Source find helpers must match column values with exact String comparison.
11. Invalid D1 records or missing and gapped original row positions must fail closed.
12. A Node RED test will show this reader is absent before implementation.
13. An actual local Workerd D1 test will import synthetic source records and prove readback plus immutable audit protection.
14. Public RPC, original source, expense/party migration, financial posting and production activation remain untouched.

## Review focus

- Missing/malformed physical source index misaddresses a different audit row; assert the reader rejects it rather than changing _rowIndex.
- A 1001st row is silently truncated by LIMIT; assert explicit over-1000 failure.
- Duplicate `Invoice ID` and `Return ID` do not mean duplicate `Log ID`; preserve original row order and all matching results.
- JSON snapshot whitespace and fixed currency-looking TEXT values are not parsed/reformatted, nor is a blank source amount coerced into 0.
- Arbitrary Sheet/column names or mocked D1 result accessors/extra private columns cannot execute unsafe SQL or leak private metadata.

---

### Task 1 — RED source contract

**Files**
- Create `tests/m03-invoice-edit-audit-read.test.mjs`.
- Create `tests/integration/m03-invoice-edit-audit-read-workerd.spec.mjs`.

**Interfaces**
- `createInvoiceEditAuditReadAdapter({DB})` yields `getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_`.
- Existing `importSourceInvoiceEditAuditWithD1({DB,sourceRows})` is used only by local synthetic test setup.

- [ ] Commit complete unit contract (source headers, physical row/empty, duplicate invoice matches, exact String, invalid input, >1000, no Promise leak, no writes).
- [ ] Commit integration test (M02 importer → actual D1 → M03 new adapter, exact audited TEXT values, 404 test-only Worker and 501 public, no changes).
- [ ] Open draft PR and observe expected RED Foundation result at test-only SHA; capture run/job URL and pass/failure counts.

### Task 2 — GREEN minimal private D1 read

**Files**
- Create `src/db/invoice-edit-audit-read.js` only.

**Interfaces**
- `createInvoiceEditAuditReadAdapter(env)`; the six original helper names accept only the exact `INVOICE_EDIT_LOG` source group. Queries are fixed `SELECT legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?`.

- [ ] Validate sheet name and source column before D1; use parameterized limit 1001.
- [ ] Reject noncontiguous provenance, >1000 rows, malformed D1 types, duplicate Log ID, extra/getter fields, failed D1 query.
- [ ] Project exactly twelve source-keyed values plus `_rowIndex`, textual exact values, and async source String matching semantics.
- [ ] Re-run full Node Foundation and fix any failures before claiming GREEN.

### Task 3 — Real Workerd, CI, review

**Files**
- Modify `.github/workflows/m03-d1-workerd.yml` by appending `node --test tests/integration/m03-invoice-edit-audit-read-workerd.spec.mjs` to the existing isolated test command.

- [ ] Verify actual local Workerd/D1 import→read, immutable audit history, untouched public Worker and all original HTML.
- [ ] Recheck exact-head CI, latest main mergeability and branch interactions.
- [ ] Update draft PR with RED/GREEN links, read/write impact and outstanding owner review; do not auto-merge or mark M03 ready.
