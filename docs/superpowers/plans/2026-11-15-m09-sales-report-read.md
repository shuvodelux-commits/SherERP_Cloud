# M09 Sales Report Read Projection — Superpowers TDD Plan

**Date:** 2026-11-15; **Spec:** `docs/superpowers/specs/2026-11-15-m09-sales-report-read-design.md`.
**Pinned source SHA:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Branch:** `m09/sales-report-read-projection-20261115`.

## RED — independent source-oracle acceptance tests
- [ ] Create `tests/m09-sales-report-read.test.mjs` first, execute frozen source `getSalesReport` and exact helper bodies under Node VM; inject source-shaped all Sales rows, active return child rows, and **precomputed authoritative settlement evidence**, no real GAS.
- [ ] Cover exact full response groups, paid customer money only, return discount rules and original-date attribution, soft delete, default/reversed/inclusive date windows, stable top-15, duplicate invoice IDs even across deleted rows, empty windows and fail-closed missing trusted evidence.
- [ ] Commit test first; record precise expected missing module failures in GitHub Actions before implementation.

## GREEN — minimal pure read model
- [ ] Create only `src/modules/sales-report-read.js` exporting `projectSalesReport(snapshot,filters,today)`. Reuse `normalizeReportRange` / `dateInReportRange`, apply numeric/row validation, source rounding/grouping, and passed-in independent customer settlement.
- [ ] Avoid new SDK/framework/RPC/SQL; do not infer Party identity or run financial writes. No shared module edits.
- [ ] Verify 8+ original-source tests, full Node suite, `verify:source`, original frontend build, existing browser/print and D1-integrated checks on exact commit. Fix source drift if any; distinguish mock oracle from real D1 proof.

## Handoff
- [ ] Diff includes spec, plan, test and one internal read model only. Document source/RPC/UI/table impact (none), TDD RED/GREEN commits, safety, rollback and remaining authenticated D1/returns settlement gates in draft PR.
- [ ] Do not auto-merge, bind public reports or claim full M09 complete.

**Rollback:** revert four new files; no database or production-data effects.
