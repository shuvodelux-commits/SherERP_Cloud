# M03 Source-shaped Expense Categories D1 Read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development, with GitHub-first RED failing tests → minimal GREEN implementation → verified full suite/Workerd.

**Goal:** Add the frozen Expense Categories five-column source group to the existing internal awaited D1 legacy catalog read API.

**Architecture:** Extend only the `CATALOG` allowlist in `src/db/legacy-catalog-read.js`. Reuse reviewed physical row-index checks, bounded parameterized SQL, strict source projections, exact `find*` helpers, and internal-only access. Prove against the actual M02 Expense Categories importer in real local Workerd/D1.

**Tech Stack:** Node.js 22 ESM test runner, `node:sqlite`, Cloudflare Wrangler 4.161.0 local Workerd/D1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-expense-category-source-read-design.md`.

## Global constraints

- Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Original physical source rows start at 2 and must be contiguous, no sorting of duplicate display names and no `Inactive` filtering for `getAllRows_`.
- No public `/api/rpc` registration, original HTML/GAS changes, production Worker/D1 binding, migration/DDL edits, staff authorization bypass, cash/bank/Party/finance writes, live business import, or new runtime dependencies.
- Exclusive M03 ownership `src/db/legacy-catalog-read.js`; preserve existing PRODUCT_CATEGORIES / PRODUCT_UNITS behavior.
- TDD proof from GitHub exact-head RED run before implementation and green Foundation+real Workerd integration before merge.

## 14-sentence module overview

1. The original Expense Categories master has five source columns and physical Sheet row references.
2. It is read by both the Expense Settings page and the New Expense bootstrap.
3. The Settings page includes inactive categories while the New Expense selector filters them.
4. The source read helper itself returns the complete category list without filtering.
5. M02 already created the Expense Categories D1 schema and reviewed one-shot importer.
6. The existing M03 legacy catalog reader only recognizes Product Categories and Units.
7. This increment adds EXPENSE_CATEGORIES to that explicit internal allowlist.
8. The new mapping preserves the five original field names, bytes, order and source row indexes.
9. Duplicate labels, empty status and inactive entries must survive the read.
10. The existing asynchronous find methods must return the same first physical match semantics as GAS.
11. Invalid source provenance, excessive rows, unavailable D1 and malformed values must fail closed.
12. Node tests first establish RED for the missing source group, followed by a minimal GREEN mapping.
13. An isolated real Workerd D1 test imports synthetic original rows and checks exact readback plus no public routes.
14. This is a read-only internal migration step, not complete Expense RPC, authorization or production readiness.

## Review focus

- D1 physical row NULL/gap/reorder returns an error instead of a different `_rowIndex`; test with real D1 mutation in isolated fixture.
- More than 1000 rows cannot silently truncate to an apparently complete source snapshot; node test.
- Duplicate Bangla label retains both entries; first-match exact case/whitespace semantics; node+Workerd.
- `Status:Inactive` and `Status:''`, blank description/timestamp preserve original source representation; node+Workerd.
- Unapproved sheet key, column name, malformed DB result, or absent binding cannot leak data or become a write path; node+Workerd.

---

### Task 1 — RED source-shaped contract

**Files:**
- Create `tests/m03-expense-category-read.test.mjs`.
- Create `tests/integration/m03-expense-category-read-workerd.spec.mjs`.

**Interfaces:**
- Existing `createLegacyCatalogReadAdapter({DB})` exported from `src/db/legacy-catalog-read.js`.
- `getAllRows_('EXPENSE_CATEGORIES')`, `getSheetHeaders_('EXPENSE_CATEGORIES')`, exact `find*` helpers.
- Existing `importSourceExpenseCategoriesWithD1({DB,sourceRows})` for real-D1 seeded fixture.

- [ ] Write Node contract with `node:sqlite` synthetic table, original 5 fields, source index, duplicate label, inactive/empty status, lookups, stale rows, DB errors and 1001-row cap.
- [ ] Write actual local Workerd+D1 integration against existing `wrangler.m02-expense-categories-test.jsonc`, including original M02 importer, row-order and no public endpoints.
- [ ] Commit tests **without** production implementation; open draft PR; observe expected assertion failure against unsupported source group from Foundation `npm test`.
- [ ] Record RED exact-head GitHub Actions run/job, not only simulated output.

### Task 2 — Minimal GREEN allowlist extension

**Files:**
- Modify `src/db/legacy-catalog-read.js` only.

**Interface:**
- Add frozen `CATALOG.EXPENSE_CATEGORIES` with headers `['Category ID','Category Name','Description','Status','Created At']`, SQL fields `['category_id','category_name','description','status','created_at']`, and fixed source-row ordered SELECT limit.

- [ ] Write the one allowlist entry; preserve existing `MAX_ROWS=1000`, `rowIndex=index+2`, field strictness and public RPC block.
- [ ] Run full Foundation suite on GREEN SHA; confirm tests, source manifest and original compiled HTML unchanged.
- [ ] If anything fails, fix first with regression evidence, preserve scope.

### Task 3 — Real Workerd integration and review

**Files:**
- Modify `.github/workflows/m03-d1-workerd.yml` by appending `node --test tests/integration/m03-expense-category-read-workerd.spec.mjs` in existing local Workerd CI job.

- [ ] Run real Workerd/D1 importer+reader test with physical provenance and no-write assertions.
- [ ] Verify exact-head checks, latest main conflicts, and no production deployment or public route.
- [ ] Update PR with design, scope, before/after, RED and GREEN run URLs, counts, risks and unmigrated Expense data/payees.
- [ ] Leave draft PR for owner; do not mark M03 fully migrated.
