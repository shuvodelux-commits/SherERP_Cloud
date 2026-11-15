# M03 — guarded source-shaped catalog append, internal only

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans and test-driven-development. No public endpoints or cloud D1 writes.

**Goal:** Port only original `Database.gs#appendRow_` for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS`, preserving the 1-based physical Sheet row return value and source column shape. Refuse unsafe data and state rather than inventing a general Sheet writer.

**Architecture:** New `src/db/legacy-catalog-append.js` composes reviewed `legacyToD1Record` mapping and a fixed allowlist of two SQL INSERT statements. One D1 `INSERT ... SELECT` with aggregate provenance and capacity checks and `RETURNING legacy_sheet_row` allocates the next row atomically in SQLite; no async read-before-write race. IDs are supplied by caller and protected by SQLite UNIQUE. Existing M03 read adapter verifies resulting physical order. Test-only Worker exercises the module without activating production public RPC.

**Tech:** Node 22+ ESM, `node:sqlite`, local Wrangler/workerd + D1. Reuse migrations/0001_core_catalog.sql, no schema changes.

**Spec:** Original immutable `legacy/source/Database.gs` appendRow_, reviewed `ProductSettings.gs` master writes, `docs/WORKSTREAMS.md` M03 and `docs/M03_PARALLEL_READINESS.md`.

## Constraints
- Only PRODUCT_CATEGORIES and PRODUCT_UNITS; refuse SETTINGS, Party, finance, arbitrary SQL or any caller-supplied table/column name.
- Not a full Database.gs emulator; deleteRow_ and updateRowFields_ are not implemented in this PR.
- No public Worker or RPC registration, no remote staging D1, no frontend, source files or D1 migrations changed.
- Caller provides source ID/name/status/Created At, cannot provide physical _rowIndex or overwrite existing IDs. Duplicate labels remain legal.
- Bounded 1,000-row catalog; contiguous physical `legacy_sheet_row` expected 2..N+1, including null/gap corruption rejection.
- Individual INSERT must enforce row allocation and provenance in the SQL statement itself. Uncertain outcomes and uniqueness exceptions must not be blindly retried with a newly minted ID.

## Task 1 — TDD / Node SQLite
Files: new `tests/m03-legacy-catalog-append.test.mjs`, new `src/db/legacy-catalog-append.js`.
- [x] RED: missing module failed; test coverage includes both catalog inserts, returned 1-based index, source readback, UTF-8, duplicate display names/IDs, missing D1, unknown sheet/fields, forged _rowIndex and required values.
- [x] Invalid provenance, 1,000-row limit and async parallel append tests reject unsafe writes or allocate distinct physical positions.
- [x] GREEN: guarded, allowlisted single-statement INSERT with RETURNING; nine focused Node SQLite tests pass.
- [x] No incomplete Promise results, arbitrary identifiers or SETTINGS reads/writes in production adapter.

## Task 2 — Actual Worker/D1 integration
Files: **separate** `tests/fixtures/m03-write-worker.mjs`, `wrangler.m03-write-test.jsonc`, `tests/integration/m03-catalog-append-workerd.spec.mjs`, existing CI entry `tests/integration/m03-workerd.spec.mjs`, and policy test `tests/m03-runtime-policy.test.mjs`. Preserve the existing read-only fixture and all CI workflow files unchanged.
- [x] RED: actual local Workerd test failed before local synthetic Worker configuration and route existed. A first read-only fixture route attempt returned 405; safely reverted rather than expanding its privileges.
- [x] GREEN: strictly fixed synthetic payloads from dedicated test-only fixture, no caller-supplied row or sheet, POST only for exact test paths. Other POST routes remain 405.
- [x] Assert real D1 concurrent row allocation, unique source IDs, replay rejection, tampered provenance rejection and source-shaped readback.
- [x] Run `node --test tests/integration/m03-catalog-append-workerd.spec.mjs` and existing read-only suite independently; both pass.
- [x] Policy test for dedicated configuration and PR-only secret-free workflow. Ruling: separate fixture is safer than mixing mutating tests into the existing read-only Worker.

## Task 3 — documentation/review/PR
Files: `docs/M03_CATALOG_APPEND.md` and this plan.
- [x] Full `npm test`: 127/127; real Workerd: 7/7 original read-only and 4/4 separate guarded-write; `verify:source`: 84 files; frontend build, 47-module M03 audit, syntax checks and `git diff --check`: pass.
- [x] Reviewed file scope: only guarded catalog append module, isolated synthetic Workerd fixture/config, existing CI integration test entry import, local-only integration/unit/policy tests, and docs. No source, GitHub Actions workflow, public RPC, migration, auth, Party, finance, deployed Worker or preview config changes.
- [ ] Open PR to main with test evidence; merge only after required GitHub/Cloudflare checks and deployment-policy review.
