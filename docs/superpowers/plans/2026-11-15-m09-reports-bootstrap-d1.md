# Superpowers TDD — M09 Reports bootstrap from existing D1 Settings

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Reports.gs::getReportsBootstrap`, existing source-verified `src/modules/reports-bootstrap-read.js`, M03 `src/db/settings-read.js`.
**Workstream:** M09 read model on reviewed M03 read-only adapter. **Main baseline:** latest `main`; one scope, one PR.
**Goal:** An *internal* awaited D1 Reports bootstrap method matching original report types, shop name, currency symbol, and shop-local month-to-date defaults, without public RPC exposure.

## Boundaries and contracts

- Reuse `createSettingsReadAdapter(env).getAppShellSettings_()` (fixed-key SQL projection) and `projectReportsBootstrap()`. Do not read the entire Settings map or return secrets.
- Caller supplies trusted, explicit `YYYY-MM-DD` shop-local date; no client-provided clock, UTC inference, global caches or user-scoped auth implied.
- Return original source-shaped **five-field** Reports bootstrap payload, with Bengali Settings text unchanged and defaults preserved.
- On missing D1, invalid date, malformed Settings results or failed query, fail closed; never return half-filled report objects.
- Keep `src/index.js`, `src/rpc/**`, existing GAS/HTML, migrations, `src/db/**`, Cash/Bank/Party/stock and public Worker untouched.
- Test-only Workerd fixture route may be added to `tests/fixtures/m03-readonly-worker.mjs`; do not mount it on the public Worker.
- No production/staging D1 writes; all test inserts occur in ephemeral local D1.

## Executable test-first sequence

1. **RED:** add `tests/m09-reports-bootstrap-d1.test.mjs` before new module. Check original projection parity, bounded safe SQL, privacy, no Promises, fallbacks, errors and invalid dates. GitHub Foundation must fail *because the new reader is absent*, not an unrelated test.
2. **GREEN:** add only `src/modules/reports-bootstrap-d1-read.js`, composing the existing source-checked projection and fixed-key async D1 Settings reader. Do not rewrite the existing M09 projector.
3. Add isolated Workerd route and a real D1 integration assertion in the existing M03 fixture/test, including a private Settings canary and a no-change row-count assertion. Test route must not enter the public Worker.
4. Verify exact-head Foundation Node tests, unchanged frozen source manifest, original frontend build, all existing isolated Workerd+D1 suites, M01 Chromium and PR safety checks. Disclose any skipped/in-progress/failed checks.
5. Open PR documenting RED/GREEN commits and run evidence, exact changed files, SQL/RPC/account nonimpact, and original-source parity.
6. M04 authenticated `reports:view`, tenant scope, real business records and report-data reconciliation remain gated. **Do not claim M09 completed or `PARALLEL-MODULE-READY`.**

**Rollback:** revert this small internal read-only PR; no schema or data restoration.
