# M10-05 — ID-less LOGS provenance digest plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. RED test → verify CI failure → minimal GREEN → full test CI → draft PR review.

**Goal:** Independently compare source and persisted D1 LOGS with row-position provenance but without inventing source Log IDs.

**Architecture:** Add one pure M10-only diagnostic hash function; reuse existing frozen M02 `LOGS` mapping/preflight. Add test-only Workerd D1 proof and PR-only M10 CI job step. Keep M10-01 final parity flags and original-ID checker untouched.

**Tech Stack:** Node.js 22 (`node:crypto`, `node:test`), Wrangler 4.161.0 isolated Workerd D1.

**Spec:** `docs/superpowers/specs/2026-11-16-m10-idless-logs-provenance-design.md`.

## Global constraints
- GitHub-first reviewable branch/PR; never direct commit to main or auto-merge.
- Source pin `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen 49-group Config inventory, original LOGS columns.
- No source ID invention; source row position is provenance, not immutable identity. No raw log contents or digest values in PR/CI.
- No live GAS export, remote D1 migration, posting kernel, source data, SQL schema, Worker public route or production cutover changes.

## Review focus
1. Duplicate identical source logs must retain separate original positions and count.
2. Content-only SQL tamper changes rowDigest, leaves positionDigest unchanged.
3. Source-row reassignment in D1 changes positionDigest; never claim original stable ID.
4. Deletion yields a lower rowCount and distinct digests against full source.
5. Accessors/symbols/non-source fields/invalid Dates fail with fixed error and do not expose private values.

## Task 1 — RED
**Files:** new `tests/m10-idless-logs.test.mjs`, new `tests/integration/m10-idless-logs-workerd.spec.mjs`, modify `.github/workflows/m10-catalog-digest-local-d1.yml`.
- [ ] Unit test source summary against independently specified SHA-256 serialization, duplicate log positions, field mutations and malformed source.
- [ ] Workerd local test: import synthetic duplicate LOGS using existing M02 one-shot importer, query D1 with fixed SQL, independently hash readback and check tamper/deletion.
- [ ] Commit tests and CI step, open draft PR; verify RED test fails due to missing M10 helper.

## Task 2 — GREEN
**File:** new `src/migration/m10-idless-logs.js`.
- [ ] Validate complete source inventory and frozen LOGS headers, reuse `prepareSourceLegacyErrorLogs`.
- [ ] Compute domain-separated row and physical-position SHA-256 digests without claiming original log IDs. All errors fixed and redacted.
- [ ] Verify exact-head Foundation `npm test` and new Workerd/D1 test, with zero failures, and recheck main overlap.

## Task 3 — Review
- [ ] Record source/target functions/files, RED/GREEN SHAs, exact-head CI evidence, limitations and rollback in draft PR.
- [ ] Confirm M10-01 and M10-03 49-group release gates remain fail-closed and no live data accessed.
- [ ] Leave PR unmerged for owner review.
