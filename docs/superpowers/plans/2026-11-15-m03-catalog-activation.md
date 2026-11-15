# M03 guarded catalog activation — implementation plan

> **For agentic workers:** Use Superpowers TDD, isolated worktrees and verification-before-completion.

**Goal:** Add one internal, concurrency-guarded `Status = Active` update for the original ProductSettings.gs category/unit reactivation path, without enabling delete, general editing or public RPC.

**Architecture:** Add a new `src/db/legacy-catalog-activation.js`, with `createLegacyCatalogActivationAdapter(env).activate_(sheetKey, rowIndex, expectedSourceId, expectedStatus)`. Allowlist two catalog tables; single parameterized `UPDATE ... WHERE ... AND (SELECT catalog_provenance_ok) RETURNING` ensures source physical position, stable ID and old status match at the same atomic write boundary. Existing no-caching reader confirms post-write status.

**Tech:** Node 24 ESM, node:sqlite unit tests, isolated Cloudflare workerd real-D1 test harness.

**Source:** legacy/source/ProductSettings.gs setProductCategoryStatus/setProductUnitStatus and Database.gs updateRowFields_, AGENTS.md and docs/WORKSTREAMS.md M03.

## Security / scope
- Only `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` with status exactly `Active`.
- A deletion request `Inactive` in original source **permanently deletes** the row. It is NOT mapped to `Status=Inactive` here.
- Read/actor permission `products.edit` remains unported, so never expose a production RPC.
- Fail closed on old status mismatch, ID mismatch, row mismatch, invalid source provenance, oversized catalog, unsupported table/field or corrupt D1 response; no retry with changed expectedStatus.
- Keep `src/index.js`, `src/rpc/**`, Cloudflare preview config, migrations, original source and financial tables unchanged.
- Reuse only the synthetic workerd write fixture, no user supplied request payload.

## Task 1: RED/GREEN local SQL
- [x] Add `tests/m03-catalog-activation.test.mjs` testing exact source ID/index, stale CAS, concurrent same-row activation, gap/null/oversized provenance, invalid inputs, no writes to other tables.
- [x] RED: missing module failed; verified expected error.
- [x] Implemented fixed SQL and validation in `src/db/legacy-catalog-activation.js`.
- [x] Targeted GREEN 7/7 and rebased full Node suite 148/148 (includes merged PR #33).

## Task 2: real Workerd D1 and CI
- [x] Added fixed synthetic `activate-category-2` and `activate-unit-1` to `tests/fixtures/m03-write-worker.mjs` (no dynamic POST body parsing).
- [x] RED: two POST actions returned 405; GREEN: real D1 CAS and no-silent-write integration tests now pass, included by existing PR-only M03 CI entry.
- [x] Combined real Workerd+D1: 13/13 passing after integrating PR #33; local run was slowed by concurrent workerd runners on the same machine.

## Task 3: docs + review + PR
- [x] Documented exact subset, stale CAS and auth gate in `docs/M03_CATALOG_ACTIVATION.md`.
- [x] Fresh verification after rebase on merged PR #33: 148/148 Node, 13/13 actual Workerd/D1, original source 84 files, frontend build, frozen 47-source M03 inventory, syntax and git diff check passed. Concurrency-heavy local Worker run took longer than usual but ultimately passed.
- [ ] Push branch and open reviewable PR; merge only with all CI and Cloudflare Preview success.
