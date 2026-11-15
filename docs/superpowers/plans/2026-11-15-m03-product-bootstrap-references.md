# Superpowers TDD — M03 Products bootstrap reference fields

**Branch:** `feat/m03-product-bootstrap-reference-settings-20261115`.
**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `Products.gs::getProductsBootstrap`, `Database.gs::getSettingsMap_`, existing M03 D1 reads.
**Design:** `docs/superpowers/specs/2026-11-15-m03-product-bootstrap-references.md`.

1. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, M03 readiness, existing `src/modules/product-master-options.js` and both read adapters. Respect shared M03 file ownership and the live RPC 501 gate.
2. **RED:** extend `tests/m03-product-master-options.test.mjs` with source VM oracle and actual SQLite D1 mock cases for source reference projection, numeric fallback, privacy, errors, and existing `getOptions()` stability. Add a fixed read-only local Workerd route and dedicated integration assertion to existing fixture and test harness. Commit test-only files first; confirm GitHub Foundation expected failure for missing `getBootstrapReferences`.
3. **GREEN:** minimal change only to `src/modules/product-master-options.js` introducing `getBootstrapReferences` that composes existing awaitable catalog options and Settings `getSettingsMap_`; preserve the old `getOptions` shape and no new dependencies. No public or production runtime changes.
4. Verify on exact head: Foundation Node tests, original-source verification, original UI build; M01 Chromium; M02/M03/M04 actual local Workerd D1; Cloudflare no-secret PR preview checks. Correct new test or source code only with genuine evidence.
5. Draft PR with RED/GREEN run logs, file inventory, original code authority, exact scope and remaining M03/M04 gates. Compare against latest `main`; keep unmerged until all nine checks pass and owner review.

**Allowed changes:** this plan and spec; tests/m03-product-master-options.test.mjs; src/modules/product-master-options.js; tests/fixtures/m03-readonly-worker.mjs; tests/integration/m03-workerd.spec.mjs. **No** live schema, `src/index.js`, RPC, frozen source or frontend changes.
