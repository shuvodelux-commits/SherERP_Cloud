# M02 reviewed core catalog tables — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; perform test-driven-development (RED→GREEN) and verification-before-completion before PR acceptance.

**Goal:** Create the first source-faithful, typed D1 SQLite tables and a no-write catalog import dry-run, without activating the ERP or changing Google Sheets.

**Architecture:** Pin original Config.gs headers and the source ProductSettings.gs behavior. A numbered D1 migration contains three STRICT tables; a narrow JS mapper verifies exact header names, and the dry-run importer rejects unsafe/ambiguous rows. GitHub CI tests SQL via Node's built-in in-memory SQLite and source mapping with frozen inventory.

**Tech Stack:** Node.js 22+, SQLite STRICT SQL, Node test runner, Cloudflare D1 migration files.

**Spec:** `docs/MIGRATION_PLAN.md` M02; `docs/WORKSTREAMS.md` M02; `docs/architecture/ADR-M02-001.md`.

## Constraints
- The original `Mohim_ERP` repository and spreadsheet are read-only.
- Do not auto-migrate all 49 groups as TEXT; this PR covers only 3 known master-data groups.
- Preserve legacy category/unit name reuse and historic product labels.
- Do not create/update real D1 resources. Local in-memory SQLite tests only.
- The dry-run prints counts only and explicitly rejects unknown input tables/columns.

## Task 1 — Three typed SQLite tables
- [x] RED: create `tests/d1-bootstrap.test.mjs`; observe missing mapping module.
- [x] GREEN: add `migrations/0001_core_catalog.sql` and `src/db/catalog-mapping.js`.
- [x] Check constraints, Unicode/phone text, duplicate IDs, row identity, delete-and-recreate labels.
- [x] Run Node tests: five SQL/map tests passed.
- [ ] CI on GitHub branch; verify original full inventory matches mapping.

## Task 2 — Safe import planning
- [x] RED: tests reject missing import module.
- [x] GREEN: `src/db/catalog-import.js` validates three groups, required IDs/names, unknown fields and duplicate legacy rows.
- [x] Run Node tests: nine tests passed including Task 1.

## Task 3 — CLI and CI
- [x] RED: CLI synthetic fixture test initially failed due to missing command.
- [x] GREEN: add `scripts/dry-run-catalog.mjs`, synthetic fixture and validation; local suite **11/11 passed**.
- [x] Preserve PII-free summary and no database writes.
- [ ] Verify GitHub branch bytes/tests, CI run and reviewable draft PR.
- [ ] Document the remaining financial/data import blockers; follow-on PRs must implement actual D1 writer only after database and security architecture approval.

**M02 complete?** No: this PR delivers a tested *three-table schema slice*, not the complete 49-group schema, full import or production cutover.
