# M03 DELETE_LOG Audit D1 Read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans and superpowers:test-driven-development. Commit test-first RED → observe failure → minimal GREEN → full Node & real local Workerd D1 → owner review.

**Goal:** Read the existing immutable M02 `DELETE_LOG` archive by its nine frozen source header names and physical source indexes.

**Architecture:** One `src/db/delete-log-audit-read.js` internal-only module, six familiar async Database.gs read helpers, one literal parameterized SELECT, bounded to 1000 physical source rows. An isolated Workerd/D1 test uses the existing M02 importer/schema and test-only Worker.

**Tech Stack:** Node 22, node:test/node:sqlite, Wrangler 4.161.0 local D1.
**Spec:** `docs/superpowers/specs/2026-11-16-m03-delete-log-audit-read-design.md`.

## Global constraints

- Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; exact nine headers, deletion log original Log ID and source row indexes.
- No modifications to other M03 open PR #382, `src/index.js`, `src/rpc/**`, production D1, original frontend, M02 importer/schema, cash/financial postings, or public RPC. M03 #22 remains open.
- All GitHub coding in PR; user is the merge owner. No deployment of live ERP.

## Fourteen-sentence overview

1. The original ERP records administrative deletion history in DELETE_LOG.
2. It has nine frozen text headers and original physical sheet row indexes.
3. A deletion is audit evidence rather than a new financial transaction.
4. Multiple deletion records may cite the same original invoice or record.
5. Original Log ID distinguishes these records independently.
6. Actor mobile numbers must preserve leading zeros.
7. M02 already has an immutable DELETE_LOG D1 table.
8. Its offline importer already validates original source records.
9. M03 still lacks an awaited, source-shaped reader for this archive.
10. The implementation will use one literal SQL SELECT and a bounded limit.
11. It will reject malformed, gapped, oversized or incomplete D1 data.
12. Original exact-match find helpers will return original physical row indexes.
13. Node and actual Workerd/D1 tests will prove fidelity, immutability and no public exposure.
14. No live data, authorization, Party role or accounting changes will be made.

## Review focus

- Gapped legacy row: refuse rather than invent row 3; test Node+real D1.
- Same invoice/record multiple Log IDs: keep all rows and first-match physical position; test.
- Leading-zero phone, whitespace/Bangla reason and original text dates: exact string; test.
- Unknown sheet/column, failed D1, getter/private unexpected columns: deny without leaking; test.
- Overflow (1001st), empty source, concurrent test suites: bounded output and no writes; test.

---

### Task 1 — RED tests before implementation

**Files**
- Create `tests/m03-delete-log-audit-read.test.mjs`.
- Create `tests/integration/m03-delete-log-audit-read-workerd.spec.mjs`.

**Interfaces**
- `createDeleteLogAuditReadAdapter({DB})` yields `getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_`.
- Existing `importSourceDeleteLogWithD1({DB,sourceRows})` seeds the *isolated* local D1 test.

- [ ] Write tests for all nine source headers, original row order, duplicate record IDs, active nonempty/empty results, strict shapes, invalid field/table, 1001-row refusal and text preservation.
- [ ] Write real Workerd/D1 importer-to-reader plus immutable SQL, no public route assertions.
- [ ] Commit tests only. Open draft PR and collect a GitHub RED Foundation failure for absent module. Do not commit production code before RED is verified.

### Task 2 — GREEN smallest reviewed reader

**Files**
- Create `src/db/delete-log-audit-read.js`.

**Interfaces**
- `createDeleteLogAuditReadAdapter(env)`; only `sheetKey==='DELETE_LOG'`, exact allowlisted nine headers.
- Fixed SQL `SELECT legacy_sheet_row,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile FROM legacy_delete_log ORDER BY legacy_sheet_row ASC LIMIT ?`.
- Reuse `requireD1Binding(env)` and no mutable module cache.

- [ ] Implement single awaited fixed SQL read with bound limit 1001, exact own-data fields, safe/contiguous provenance and unique Log ID.
- [ ] Map to exactly nine source keys plus `_rowIndex`. Implement String-exact find helpers.
- [ ] Check Node full suite `npm test` in GitHub Foundation; fix failures before declaring success.

### Task 3 — Real Workerd CI and review

**Files**
- Modify `tests/integration/m03-workerd.spec.mjs` with *one import* for `./m03-delete-log-audit-read-workerd.spec.mjs` to reuse already existing M03 local D1 CI, avoiding conflicting modifications to #382's workflow.

- [ ] Verify actual Workerd/D1 source-to-archive projection and immutable audit storage; preview remains DB-free.
- [ ] Check full exact-head GitHub Actions and compare latest main for overlap/conflicts.
- [ ] Record RED/GREEN evidence in draft PR; do not auto-merge or claim M03 readiness.
