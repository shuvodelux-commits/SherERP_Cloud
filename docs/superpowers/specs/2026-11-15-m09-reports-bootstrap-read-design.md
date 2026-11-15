# M09 Reports Bootstrap read projection — source parity

**Date:** 2026-11-15. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Reports.gs::getReportsBootstrap`, `REPORT_TYPES`, `legacy/source/Config.gs::APP_NAME` and `legacy/source/reports.html`.

## User-visible requirement

The original Reports screen calls `serverCall('getReportsBootstrap', authToken)` *before* loading the six report panels. It reads the ordered `reportTypes` list, `currencySymbol`, `shopName`, `defaultFrom`, and `defaultTo`. The pre-existing Sales, Purchase, Stock, Cash/Bank, Profit and Balance Sheet M09 read projections cannot replace this bootstrap. Keep the original report UI, initial date controls, print shop header, displayed labels and currency contract without redesign.

## Chosen approach

Create an independent, **pure internal** `projectReportsBootstrap(settingsMap,today)`. The caller must separately authenticate, authorize `reports:view`, obtain tenant-scoped original Settings map, and calculate trusted shop-local `today` as YYYY-MM-DD. The projection has no D1 reads/writes, RPC registry, configuration mutations, permission checks or shared caching. Do **not** expose a public endpoint before M04 and M09 authorized Settings data readers pass real D1 reconciliation.

The complete source JSON response contains, in order:
`{reportTypes:[{key,label}×6],currencySymbol,shopName,defaultFrom,defaultTo}`.

- Preserve the exact six frozen REPORT_TYPES key/label pairs and ordering: `sales`, `purchase`, `stock`, `cashbank`, `profit`, `balancesheet`.
- Source Settings value `settingsMap['Currency Symbol'] || ''`: an empty or other falsey trusted scalar becomes `''`. No trimming/translation/coercion for truthy sheet scalar values; not a currency converter.
- Source `settingsMap['Shop Name'] || CONFIG.APP_NAME`: default is exactly the pinned `Hardware Store ERP`, and falsey trusted values fall back. Do not infer from user profile, Party name, shop ID, or customer.
- Default dates are the first day of the shop-local `today` month and `today`. Reuse existing `reportDefaultRange(today)` as the only date validator; no ambient time, date-range query, or timezone conversion.
- Return fresh reportTypes objects to avoid one request modifying subsequent snapshots; no mutation of the caller's Settings map. Validate plain own-data object with no inherited values/accessors, no Promise, non-scalar settings, or invalid `today`. Intentional fail-closed validation on corrupt trusted inputs may differ from source GAS's loose runtime typing.

## Tests and safety

Executable `node:vm` oracle evaluates the original `REPORT_TYPES` constant and unmodified `getReportsBootstrap` with frozen `CONFIG.APP_NAME`, `requirePermission_(token,'reports','view')`, Settings map and shop-local date stubs. Exact JSON parity across custom and missing settings, all six labels, fallback behavior, month/leap dates, and source UI calls. Tests assert no source DOM/print change, no public RPC activation, no DB or financial writer, isolation and fail-closed invalid input.

**Scope:** only four new files: this spec; `docs/superpowers/plans/2026-11-15-m09-reports-bootstrap-read.md`; `tests/m09-reports-bootstrap-read.test.mjs`; `src/modules/reports-bootstrap-read.js`. No modifications to legacy sources, M04 auth, Settings writers, M08 financial modules, Worker bindings, D1 SQL or existing report adapters. GitHub-first TDD: commit tests, observe meaningful **RED**, then minimal **GREEN**, inspect exact-head CI and four-file diff. Revert four files to roll back; no data migration.

**Remaining:** authenticated M04 reports:view public bridge, reviewed M09 Settings source read/provenance and real D1 fixtures, original reports.html browser integration. Separate PR #206 Balance Sheet remains unmerged while its Workerd/D1 CI runs; this branch must not depend on it.
