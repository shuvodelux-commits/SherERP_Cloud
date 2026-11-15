# M03 Product Master Creation Preflight — Superpowers TDD Plan

**Frozen source** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `ProductSettings.gs`, `Utils.gs`.
**Design:** `docs/superpowers/specs/2026-11-15-m03-product-master-create-preflight.md`
**Branch:** `feat/m03-product-master-create-preflight-20261115`; **owner:** single M03-core branch.
**No implementation authorization for source-ID allocation or D1 writes in this PR.**

1. Inspect original frozen `addProductCategory`, `addProductUnit`, `sanitizeInput_`, `src/db/legacy-catalog-read.js`, `AGENTS.md` and M03 readiness. Preserve the original duplicate-status semantics precisely.
2. **RED:** add `tests/m03-product-master-create-preflight.test.mjs` using original source VM oracle plus real Node SQLite D1 adapter tests. Cover blank, trimming, active duplicate, source fallback for blank Status, two inactive duplicates, casefold Unicode, stale corrupt physical index, duplicate source IDs, invalid input and DB error. Extend `tests/fixtures/m03-readonly-worker.mjs` with two fixed-name read-only routes, and `tests/integration/m03-workerd.spec.mjs` with source-shaped real local D1 tests. Commit tests before module. Observe expected `ERR_MODULE_NOT_FOUND` in GitHub Foundation.
3. **GREEN:** add only `src/modules/product-master-create-preflight.js`. Use existing awaited legacy catalog adapter and source `String(row[Name]).trim().toLowerCase()` and `String(Status || 'Active').toLowerCase()` for duplicates. Fail closed when catalog provenance unsafe; no new SQL, D1 transaction, public RPC, mutation, or caching.
4. Verify exact-head Foundation source/Node/frontend, M01 Chromium, M02 and M04 regressions, M03 actual isolated Workerd/D1, Cloudflare preview safety. Investigate any failure before claiming green and correct in dedicated commits. Record RED and GREEN run links.
5. Open/update a narrow draft PR, compare latest main for overlapping changes, document source parity and known non-atomic preflight limitation. Keep merge for owner review and all 10 CI checks.

**Allowed:** 2 docs, 1 new source module, 1 Node test, existing test-only Worker, existing Workerd integration test. **Forbidden:** shared SQL adapters/migrations, `src/index.js`, RPC registry, original .gs/HTML, remote D1 and production deployment.
