# M03 Product Category/Unit Status Workflow — Superpowers TDD Plan

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/ProductSettings.gs` and `Utils.gs`.
**Design:** `docs/superpowers/specs/2026-11-15-m03-product-master-status-workflow.md`
**Branch:** `feat/m03-source-product-master-status-workflow-20261115` based on latest `main`.
**Ownership:** M03 internal ProductSettings master workflow; existing shared SQL adapters consumed unchanged.

1. Confirm `AGENTS.md`, M03 readiness, original ProductSettings status behavior, source `ok_` envelope and prior real D1 reader/update/delete tests. Restrict public input to the two supported UI statuses; keep business route disabled until M04 authorization.
2. **RED:** Commit `tests/m03-product-master-status-workflow.test.mjs` first, with a real `node:sqlite` D1 adapter and original frozen VM oracle, name/status/source-ID preimages, missing identity, duplicate replay, corrupted row, forced rollback, invalid-status fail-closed. Add a distinct test-only Worker and Workerd D1 fixture with fixed routes, synthetic UUID, `workers_dev:false` and one additive import in `tests/integration/m03-workerd.spec.mjs`. Observe exact GitHub Foundation `ERR_MODULE_NOT_FOUND` for the absent module and document run SHA.
3. **GREEN:** Add only `src/modules/product-master-status-workflow.js` with `createProductMasterStatusWorkflow(env)`; delegate to existing awaited read, guarded update and transactional delete adapters. Preserve original `ok_` / `fail_` response envelope for supported UI statuses and exact source IDs. No new D1 SQL, public endpoints, logging or auth bypass.
4. Verify exact-head Foundation Node tests, 84 frozen files and 36 HTML includes; real local Workerd D1 execution, M02/M04 regression suites, Chromium and Cloudflare preview safety. If failures occur, investigate root cause, patch narrowly, rerun on the final exact head.
5. Open/update draft PR with source pin, RED/GREEN evidence, paths changed, no-live-DB gate, rollback and remaining M03/M04 integration blockers. Leave draft until 9/9 pass and owner review.

**Files:** two new docs, new `src/modules` internal workflow, Node unit + local Worker/config/integration suite, one import in existing M03 aggregator. Do not edit existing catalog SQL adapters, original `.gs`, `src/index.js`, `src/rpc`, numbered migrations, production Cloudflare configs or original frontend.
