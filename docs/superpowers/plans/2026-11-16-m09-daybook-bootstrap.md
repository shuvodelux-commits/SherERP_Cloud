# M09 Day Book bootstrap — Superpowers test-first plan

Date: 2026-11-16. Branch: m09/daybook-bootstrap-source-parity-20261116. Spec: docs/superpowers/specs/2026-11-16-m09-daybook-bootstrap-design.md.

## Task 1 — RED contract evidence
- Inspect frozen DayBook.gs::DAY_BOOK_MODULES/getDayBookBootstrap and daybook.html::dbLoad; confirm main has no Day Book bootstrap projection and no public RPC route.
- Write tests/m09-daybook-bootstrap.test.mjs before code. Execute the unmodified source function in a sandbox with stubbed requirePermission_, getSettingsMap_, ok_ and authenticated actor. Assert four-field parity, module order, role-specific isAdmin, settings numeric/fallback behavior, UI call and rejection of untrusted inputs.
- Commit test only; inspect GitHub Actions on test-only SHA to establish expected missing-implementation RED rather than guessing a test outcome.

## Task 2 — Minimal GREEN
- Add src/modules/daybook-bootstrap-read.js exporting projectDayBookBootstrap(settingsMap, actor) as a pure source-faithful projection for previously authorized trusted inputs.
- No D1, M04/RPC registry or frontend modifications. Keep per-request array isolation, validation and parity; do not attempt financial row reads.
- Re-run Node suite on the exact head via GitHub Actions, inspect observed CI. If failing, debug narrowly and rerun.

## Task 3 — Review and handoff
- Review scoped diff and source oracle, audit that public RPC remains fail-closed, record file/RPC/table impact and explicit missing integration gates in the draft PR.
- No automatic merge or production enablement. Rollback: revert spec/plan/test/module.
