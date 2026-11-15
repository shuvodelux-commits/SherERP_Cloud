# M03 Atomic Catalog Batch Append Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with TDD, task by task.

**Goal:** Add source-shaped atomic `appendRows_` for reviewed category/unit D1 masters only.
**Architecture:** Reuse approved strict `legacyToD1Record` mapping; validate whole array first, then perform one parameterized `INSERT ... SELECT ... FROM json_each(?) ... RETURNING` per call, with the original source row order.
**Tech Stack:** Node ESM, node:test, node:sqlite, Cloudflare Wrangler local Workerd/D1.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-catalog-batch-append-design.md`

## Global Constraints
- Scope: `PRODUCT_CATEGORIES`, `PRODUCT_UNITS` only; `SETTINGS` and financial/stock tables forbidden.
- Never change original GAS files, schema, `src/index.js`, `src/rpc`, deployment bindings or production data.
- No user-controlled SQL identifiers; all values parameterized.
- No leaked partial inserts, no fabricated GAS LockService.

## Review Focus
- Input contains a valid and invalid row: no row persists.
- Input contains a duplicate ID from a previously committed batch or within itself: no new rows persist.
- Inconsistent stored legacy row positions: guard fails atomically.
- 999 existing rows plus 2 valid rows: no rows persist.
- Valid identical display names, mixed languages and source row physical order: preserved.

### Task 1 — Atomic batch method with Node SQLite TDD

**Files:**
- Modify: `src/db/legacy-catalog-append.js`
- Create: `tests/m03-legacy-catalog-batch.test.mjs`

**Interfaces:** `createLegacyCatalogAppendAdapter(env).appendRows_(sheetKey,rowObjs) -> Promise<void>`.

- [ ] RED: Tests for 2+ ordered category and unit rows, empty no-op, same-name duplicates, rejected invalid/unknown input, duplicate-ID rollback, gap/null provenance refusal, max-1000 boundary and binding validity.
- [ ] Confirm RED: `node --test tests/m03-legacy-catalog-batch.test.mjs`, failures prove method missing.
- [ ] GREEN: Reuse fixed catalog mapping and validate every row, insert all rows with one bound JSON SQL statement returning inserted physical positions, check exactly N results and source index range.
- [ ] GREEN targeted: new file and existing append tests both pass.

### Task 2 — Real local Workerd/D1 and final safety evidence

**Files:**
- Modify: `tests/fixtures/m03-write-worker.mjs`
- Modify: `tests/integration/m03-catalog-append-workerd.spec.mjs`
- Create: `docs/M03_CATALOG_BATCH_APPEND.md`

**Interfaces:** test-only synthetic fixed endpoint, no arbitrary body or group payload; existing CI integration entry imports this test file.

- [ ] RED: New test-only Worker route fails before implementation of synthetic batch route.
- [ ] GREEN: Add hardcoded two-ID catalog batch route, verify ordered readback and duplicate replay failing without extra rows.
- [ ] Run `node --test tests/integration/m03-workerd.spec.mjs`, `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-callers.mjs --check`, JS syntax and `git diff --check`.
- [ ] Source, table, RPC, test and financial impact inventory in docs and PR. Commit once and open PR; do not merge.

## Completion contract
Only claim test results explicitly observed on fresh local run. No public deploy or remote D1 writes.
