# M01 Dashboard — tablet breakpoint and accessible dashboard regions

**Issue:** #567. **Owner:** M01 compiled dashboard UI/Playwright only. **Base main:** `22738bcb3bbd63aafdea8ebe98e7505102e03675` (includes merged #607 and #610). **Current independent M09 lane:** PR #612 touches M09-only files and must not be edited here. **Pinned legacy:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Implementation overview (12 sentences)

1. The HisabIQ dashboard UI copy has shipped to `main` through PRs #570, #588 and #601.
2. The account-switch KPI isolation patch #607 is also merged, and the M09 source-evidence contract #610 is independent.
3. Dashboard issue #567 explicitly requires 390, 768 and 1440-pixel Playwright evidence.
4. The current M01 browser suite has no 768-pixel dashboard regression, leaving tablet breakpoints under-tested.
5. M01 will add a synthetic authorized fixture at 768x1024 without exposing any real business data or contacting production.
6. The test will assert six default KPI cards and four default panels and that the metric layout has three columns at the tablet breakpoint.
7. The test will check that the document has no horizontal overflow and preserve a full-page tablet screenshot in existing CI artifacts.
8. It will open the existing customization dialog, confirm keyboard accessibility, and save a tablet customization screenshot.
9. Metric and panel containers currently lack explicit named accessible regions for assistive navigation at this dense breakpoint.
10. RED will assert the two named regions are present, with the current markup expected to fail.
11. GREEN will add only semantic `role=region` and `aria-label` metadata to existing containers; the default visible widgets, CSS dimensions, data binding and routing will not change.
12. All required exact-head GitHub CI, including M01 Chromium smoke tests, must pass before review and a separately human-approved merge.

## TDD and ownership gates

- RED: `qa/m01-browser.spec.mjs` tablet browser assertion fails on missing named metric and panel regions.
- GREEN: `src/ui/hisabiq-dashboard.html` contains named regions, and Playwright verifies breakpoint/visible card counts, modal and screenshots at 768.
- No edits to `legacy/source/**`, `src/db/**`, `src/rpc/**`, `src/index.js`, migrations, shared posting, `package.json` or workflows.
- No change to accounting totals, authorization, direct D1 reads, credentials or public endpoints.
- **Roll back:** revert this small M01 PR; dashboard data sourcing remains gated through M09/M03/M04.
- **Merge order:** #607, #610 already merged; this PR may merge independently of open M09 #612 after full CI, review and approval.
