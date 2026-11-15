# M09 Reports Bootstrap — Superpowers RED → GREEN plan

**Date:** 2026-11-15. **Branch:** `m09/reports-bootstrap-read-20261115` from current main. **Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Reports.gs::getReportsBootstrap`, `Config.gs::APP_NAME`, `reports.html`.

1. **Inspect:** Original `REPORT_TYPES` six-tab inventory, permission `reports:view`, `getSettingsMap_`, falsey Currency Symbol and Shop Name defaults, report default dates and UI `serverCall('getReportsBootstrap',authToken)`. Confirm no existing `reports-bootstrap-read.js` and no M09 shared-file ownership conflict.
2. **RED:** Create `tests/m09-reports-bootstrap-read.test.mjs` first, executing unmodified frozen source `REPORT_TYPES` and `getReportsBootstrap` with deterministic settings/config/permission/time. Cover entire result shape and order, exact labels, default+custom settings, truthy scalar preservation, month/leap dates, fresh results, malformed trusted snapshots, no UI/RPC writes. Commit test only, create draft PR, obtain GitHub Actions expected missing-module failure.
3. **GREEN:** Add minimal `src/modules/reports-bootstrap-read.js` exporting `projectReportsBootstrap(settingsMap,today)`, reusing `reportDefaultRange`. No dynamic settings load or global mutable state. Match source JSON for valid inputs; reject corrupted/unsafe settings objects.
4. **Verification:** Re-run exact-head GitHub Actions full Node suite, frozen 84-source audit, 36 original frontend include build, isolated local D1/Workerd auth/Party checks, Chromium desktop/mobile/A4 and Cloudflare preview build. Mark actual conclusions; avoid live D1-ERP claims. Fix only source-detected divergence, rerun.
5. **Review:** Diff only four newly added files; log RED/GREEN SHAs, job links, report contract inventory, unchanged RPC/schema/frontend/financial data, future authenticated Settings+report bridge gate and rollback. Leave draft for owner review; don't auto-merge.

**Rollback:** revert spec/plan/test/module; no SQL, data or session changes.
