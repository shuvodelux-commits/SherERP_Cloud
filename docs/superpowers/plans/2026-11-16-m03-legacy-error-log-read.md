# M03 LOGS Private D1 Read — Superpowers Implementation Plan

> **For agents:** Follow `superpowers:executing-plans`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. GitHub is the source of truth; no direct main commits. Test-first RED → observe → minimal GREEN → full checks.

**Goal:** Extend M03's source-shaped async D1 reads to the original ID-less `LOGS` archive without inventing log identities or disclosing private error messages.

**Architecture:** Private `src/db/legacy-error-log-read.js` with one literal bounded read of existing M02 `legacy_error_logs`. Unit tests target the original frozen `LOGS` source contract; real local Workerd+D1 tests use the already reviewed one-shot M02 importer. A new narrowly-scoped PR-only workflow avoids conflicting with parallel M03 workflow/aggregator changes.

**Tech:** Node 22 ESM tests, Node sqlite, Cloudflare Workerd via Wrangler 4.161.0, ephemeral local D1.

**Design:** `docs/superpowers/specs/2026-11-16-m03-legacy-error-log-read-design.md`.

## 14-sentence overview

1. The original LOGS Sheet stores internal error history.
2. It has exactly Timestamp, Context and Message headers.
3. Every record also has the original physical Sheet row location.
4. It has no original source Log ID.
5. Duplicate events must remain distinct even with identical values.
6. M02 has already created a typed D1 archive and one-shot offline importer.
7. That importer preserves the text and row provenance but has no public route.
8. The next M03 gap is a bounded awaited source-header reader.
9. It must not expose private error messages through public RPC.
10. It must validate every field and reject incomplete physical row provenance.
11. It must preserve leading spaces, Bangla text and blank timestamps.
12. It must return original exact String-value lookups without inventing identifiers.
13. Node and actual local Workerd/D1 tests will confirm this behavior and route isolation.
14. Original ERP, live Google Sheets, migrations, finance, Party, and production deploy remain untouched.

## Tasks

### Task 1 — RED tests without implementation

**Files:**
- Create `tests/m03-legacy-error-log-read.test.mjs`.
- Create `tests/integration/m03-legacy-error-log-read-workerd.spec.mjs`.

**Contract:** `createLegacyErrorLogReadAdapter({DB})` returns six async helpers `getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_`. Accept only `LOGS`, original three headers, exact first physical row, no writes.

- [ ] Write unit tests for original header order, duplicates, blank dates, physical row gaps, 1001-record cap, failed SQL, getters/extra columns/nontext and no source ID.
- [ ] Write isolated Workerd D1 test using M02 importer with duplicates and blank timestamp, check original archive read fidelity and public route absence.
- [ ] Commit tests first, open draft PR, confirm GitHub Foundation RED failure specifically from missing implementation (not unrelated preexisting failure).

### Task 2 — Minimal GREEN

**File:**
- Create `src/db/legacy-error-log-read.js`.

**Implementation:** Fixed SQL `SELECT legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row ASC LIMIT ?`; bind 1001; strict own data + types; contiguous physical index and 1000 cap; map to `Timestamp,Context,Message,_rowIndex`; exact `String` helper comparisons; sanitize D1 exceptions. No caching, writes, mutation or IDs.

- [ ] Implement after confirmed RED only.
- [ ] Run complete Foundation suite with GitHub exact-head CI and check 0 failures/skips.
- [ ] Fix regressions under the same PR only; don't claim green without evidence.

### Task 3 — Actual Workerd+D1 proof and owner review

**File:**
- Create `.github/workflows/m03-legacy-error-log-read.yml`.

**CI:** PR-only, no secrets, locked npm dependencies, pinned `wrangler@4.161.0`, execute only `node --test tests/integration/m03-legacy-error-log-read-workerd.spec.mjs`, no deployment or remote D1.

- [ ] Read source and CI logs proving actual local M02 importer → D1 archive → new M03 read passes.
- [ ] Ensure DB-free `src/index.js`/preview Worker unchanged, and exact PR changed files do not overlap unmerged #382/#385.
- [ ] Update PR with RED/GREEN proof, residual risks and original data cutover blockers. Owner reviews/merges; M03 remains not production ready.
