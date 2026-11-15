# M03 Tail-Only Catalog Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute tasks with TDD.

**Goal:** Add a source-safe, last-row-only category/unit deletion primitive without unsafe middle-row compaction.
**Architecture:** New D1 adapter uses one parameterized DELETE ... RETURNING with exact stable-ID, preimage and full provenance guard. New isolated local-only Workerd fixture tests real D1 without deployed write endpoints.
**Tech Stack:** Node 24 ESM, node:test, node:sqlite, Cloudflare Wrangler 4.161 local Workerd/D1.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-catalog-tail-delete-design.md`

## Global Constraints
- No `src/index.js`, `src/rpc`, `src/db/legacy-catalog-append.js`, financial tables, migrations, original source or public Worker changes.
- Only two reviewed catalog groups, and only final physical source row. No preflight JS read/write, LockService clone, caching or unguarded reindex.
- All developer/test Workers remain local and accept hard-coded synthetic fixtures only.

## Review Focus
1. Correct, last row, exact source preimage: DELETE and subsequent read/append succeed.
2. Middle row: refuses delete and preserves entire dataset.
3. Stale/mismatched ID, name, status or row index: refuses, no writes, replay refused.
4. Gapped/null provenance, >1000 rows: refuses even when target at maximum position.
5. Empty table, unknown tables, forbidden fields, invalid parameter types: fail closed.

### Task 1 — Node SQLite TDD
**Files:** `tests/m03-catalog-tail-delete.test.mjs` (new), `src/db/legacy-catalog-tail-delete.js` (new).
**Interface:** `createLegacyCatalogTailDeleteAdapter(env).deleteLastRow_(sheetKey,rowIndex,{sourceId,name,status}) -> Promise<void>`.
- [ ] RED: Write test for correct final row, unchanged neighbors, subsequent append; rejection of middle/stale/invalid/corrupt.
- [ ] Observe expected failing tests before implementation.
- [ ] GREEN: Implement SQL DELETE guarded by exact source ID, row index, expected name/status and catalog-wide provenance; return undefined only after verified one-row result.
- [ ] Run node test file and existing catalog tests.

### Task 2 — Actual Wrangler D1, docs and PR
**Files:** `tests/fixtures/m03-tail-delete-worker.mjs`, `wrangler.m03-tail-delete-test.jsonc`, `tests/integration/m03-catalog-tail-delete-workerd.spec.mjs` (new); `tests/integration/m03-workerd.spec.mjs` (one import); `docs/M03_CATALOG_TAIL_DELETE.md` (new).
- [ ] RED: Fixed route absent; real D1 test rejects.
- [ ] GREEN: Test-only fixed route, verify last-row delete, stale retry refusal and catalog append source-row readback.
- [ ] Full `npm test`, `node --test tests/integration/m03-workerd.spec.mjs`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-callers.mjs --check`, syntax and diff checks.
- [ ] Rebase on newest main, rerun checks, open PR with file/table/RPC impact, source pin, evidence and explicit non-financial limitations. Do not merge.

## Completion contract
No claim of full source-shaped `deleteRow_` or financial kernel; PR is review-only and guarded.
