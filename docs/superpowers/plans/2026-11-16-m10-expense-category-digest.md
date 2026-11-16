# M10-04 Expense Categories Digest Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. RED failing GitHub CI → minimal GREEN → full CI → owner review; never auto-merge.

**Goal:** Extend M10 original-ID + full-row digest parity to the reviewed Expense Categories master using independent local D1 readback.

**Architecture:** Add one mapping to the existing source-pinned M10 pure digest calculator. Create a test-only Workerd/D1 readback test reusing the M02 offline importer, and add it to existing PR-only M10 CI.

**Tech stack:** Node.js >=22, node:crypto, node:test, Wrangler 4.161.0, isolated Workerd/D1.

**Spec:** `docs/superpowers/specs/2026-11-16-m10-expense-category-digest-design.md`.

## Global constraints
- GitHub-first branch/commits/PR; no direct main changes.
- Frozen legacy SHA: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Only M10 digest, its tests, M10 PR-only CI and these docs. No new M02 SQL/Worker runtime/import API or original source edits.
- No live Sheets access, source data/IDs/secret logging, production D1, remote migrations, finance posting, public endpoints or cutover.
- Preserve existing hash serialization and source ID+physical-position semantics; never claim real business migration.

## Review focus
- Description-only mutation must alter whole-row digest without altering original-ID digest.
- Original ID mutation must alter both digests, even for duplicate human-readable names.
- Field insertion order and Date representation must not change the source digest.
- Duplicate, missing, reordered physical rows and accessor-backed source fields must be rejected with fixed redacted errors.
- Real local D1 readback must detect missing rows and absence of HTTP import/RPC surfaces.

## Task 1 — RED tests
**Files:** `tests/m10-catalog-digest.test.mjs`, new `tests/integration/m10-expense-category-digest-workerd.spec.mjs`, `.github/workflows/m10-catalog-digest-local-d1.yml`.
- [ ] Add tests requiring `summarizeM10Catalog` to accept EXPENSE_CATEGORIES using source-shaped rows.
- [ ] Assert independent readback, SQL-tamper detection, row removal, no public routes; import actual synthetic rows through existing M02 adapter.
- [ ] Wire new integration spec to existing PR-only M10 CI; commit tests before implementation.
- [ ] Inspect RED CI and confirm failure is from unsupported EXPENSE_CATEGORIES digest, not unrelated setup.

## Task 2 — GREEN minimal implementation
**File:** `src/migration/m10-catalog-digest.js`.
- [ ] Import reviewed Expense Categories mapper/preflight; add exact `EXPENSE_CATEGORIES` configuration with six source fields and ID mapping.
- [ ] Call `verifyExpenseCategoryMapping(inventory)` as appropriate; reuse all existing M10 hash/validation logic unchanged.
- [ ] Run full `npm test` and dedicated actual local Workerd/D1 test on exact-head CI.
- [ ] Document RED/GREEN SHA, tests and release blockers in draft PR.

## Task 3 — Review
- [ ] Verify no shared M02/M03/M08 files touched and current main has no overlap.
- [ ] All M10-01 and M10-03 release gates remain fail-closed; no authority for live source import.
- [ ] Leave draft PR unmerged for owner approval.
