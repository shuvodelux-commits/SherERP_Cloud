# M03 Guarded Catalog Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; follow test-driven-development (RED → GREEN) for each task.

**Goal:** Safe, source-header-shaped internal category/unit D1 updates with atomic record-identity and stale-value checks.
**Architecture:** Separate new adapter in `src/db/legacy-catalog-update.js` keeps ownership isolated from in-review append PR #33. Fixed per-sheet SQLite UPDATE SQL and a four-argument contract require the original row ID and expected name/status; no public Worker code changes.
**Tech Stack:** Node.js ESM >=22, node:sqlite, node:test, Wrangler local Workerd/D1.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-catalog-update-design.md`

## Global Constraints
- Change no schema, `src/db/legacy-catalog-append.js`, `src/index.js`, `src/rpc/**`, Cloudflare preview config, production data, or immutable legacy source.
- Keep business permission gate closed; no endpoint in production.
- SQL table and column names fixed; no user-generated identifiers.
- No fake LockService, silent Promise, JS SELECT→UPDATE gap, or stock/ledger/Cash/Bank writes.

## Review Focus
1. Stale preimage name or status: zero change and rejected.
2. Correct row number but wrong original stable ID: zero change and rejected.
3. Corrupt/gapped/null stored row provenance: zero change and rejected.
4. Unknown column / ID / Created At / fabricated source row and invalid types: rejected before any SQL.
5. Updating one field does not alter the other, exact UTF-8 names preserved.

### Task 1 — Narrow repository update, test-first

**Files:**
- Create: `tests/m03-legacy-catalog-update.test.mjs`
- Create: `src/db/legacy-catalog-update.js`

**Interface:** `createGuardedCatalogUpdateAdapter(env).updateRowFields_(sheetKey,rowIndex,fields,precondition): Promise<void>`.

- [ ] Write Node SQLite tests: exact partial and combined updates, stale preimage, wrong ID/row, corrupt source provenance, rejected inputs, no writes to SETTINGS.
- [ ] Run `node --test tests/m03-legacy-catalog-update.test.mjs`. RED must be missing import/adapter (or missing implementation), not syntactic failure.
- [ ] Add smallest fixed-SQL adapter with strict validation and a single atomic UPDATE ... RETURNING.
- [ ] Run targeted Node tests; verify green and no other regressions.

### Task 2 — Isolated real Workerd/D1 evidence

**Files:**
- Create: `tests/fixtures/m03-update-worker.mjs` (fixed synthetic routes, not deployable)
- Create: `wrangler.m03-update-test.jsonc` (synthetic D1 UUID only)
- Create: `tests/integration/m03-catalog-update-workerd.spec.mjs`
- Modify: `tests/integration/m03-workerd.spec.mjs` (only new import)
- Create: `docs/M03_CATALOG_UPDATE.md`

- [ ] Write failing Workerd tests for a valid update, a stale duplicate attempt and invalid external route/payload; prove RED before adding test-only route.
- [ ] Implement fixed synthetic-only route, no caller-defined tables or values; observe real D1 GREEN.
- [ ] Run `node --test tests/integration/m03-workerd.spec.mjs`, full `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-callers.mjs --check`, syntax checks and `git diff --check`.
- [ ] Document provenance, changed files, SQL/financial impacts, and known gaps, then commit and open a separate GitHub PR without merging.

## Completion criteria
Every claim backed by fresh local output and CI; Worker test config has no real secrets or public route. M03/M04/shared-kernel readiness remains false.
