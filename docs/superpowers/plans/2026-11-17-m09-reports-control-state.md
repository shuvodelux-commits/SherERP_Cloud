# M09 Reports controls — RED→GREEN implementation plan

> **For agentic workers:** use Superpowers test-driven-development. No production code until exact failing test verified.

**Goal:** Fail closed when a Reports print preview is stale, pending, not loaded, or has an invalid date range, while respecting snapshot tabs.

**Architecture:** One pure M09 module, one Node test file, M09 plan/spec and optional local-only Playwright control audit. Never import it into public runtime from this branch.

**Tech Stack:** Node 22+, original HTML/CSS/JS, Playwright Chromium browser fixture.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-reports-control-state-design.md`.

## Constraints / ownership
- M09 owns `src/modules/m09-report-control-state.js`, `tests/m09-report-control-state.test.mjs`, `qa/m09-reports-control-audit.mjs`, M09 docs.
- M01 owns wiring, toolbar accessibility, Print gating and report panel presentation in the preserved frontend.
- M03/M04 own all shared RPC, authenticated tenant source reads and Worker contract; do not activate a report or synthesize successful financial RPC.
- Frozen original source must verify unchanged (84 files).

## Task 1: RED
- [ ] Commit failing test coverage for all six original tab IDs, date-dependent/snapshot split, stale filters, print before success, in-flight RPC, invalid date and accessor-proof inputs.
- [ ] Execute exact test-only GitHub head in isolated Node checkout; record expected missing-module failures.

## Task 2: GREEN
- [ ] Implement smallest pure projector with strict own-data input, real calendar dates, predictable fixed reason codes and frozen result.
- [ ] Run focused tests and complete `npm test` plus `npm run verify:source`.
- [ ] Verify no import from Worker, public RPC or deployed frontend.

## Task 3: Control audit and handoff
- [ ] Use Playwright on original compiled UI to verify six tab clicks, tab keyboard reach, Print before loaded, period edits and cached report result behavior; use synthetic loaded-state fixtures only.
- [ ] Record actual observed defects and the M01 frontend integration contract, with screenshots only if they add diagnostic value.
- [ ] Open scoped PR against latest main; run full required exact-head CI, review, merge and verify source on main.
- [ ] Update Issues #431 and #25 with precise upstream prerequisites, no promise of live reports.

**Rollback:** revert M09-only files. No DB, business data, financial statements or UI deployment changes.
