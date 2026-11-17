# M09 Profit deleted vendor/expense parity — RED→GREEN execution plan

> **For agentic workers:** follow Superpowers TDD, failing tests first and observed RED→GREEN at exact GitHub SHAs. One M09-only PR.

**Goal:** Match original `computeProfit_` activeRows_ deletion behavior for vendor sourcing and expense cost components.
**Workstream/issue:** M09 / #431; coordination #456.
**Base:** `5290a06abda5a0e42192b8bfbcc2f83e59495647`, after #593 merge.
**Source:** frozen `Reports.gs::computeProfit_` and `DeleteEngine.gs::activeRows_ / isDeleted_`.

## Scope/owners
Only `tests/m09-profit-report-read.test.mjs`, `src/modules/profit-report-read.js`, this plan and `docs/superpowers/specs/2026-11-17-m09-profit-deleted-vendor-expense-parity-design.md`. No src/db, migrations, src/rpc, Worker, posting, legacy/source, UI or M01 changes. No shared D1 writes.

## 1 — RED (tests-first)
1. Replace the fake `activeRows_` VM oracle callback with the original frozen function, maintaining a source-shaped table map for VENDOR_SOURCING and EXPENSES.
2. Add deleted vendor, deleted expense, deleted historic row and false-marker tests with exact COGS, expense and net profit expectations.
3. Commit only tests, spec and plan before production implementation.
4. Verify focused RED on the exact test-only commit: only source-deletion cases should fail; unchanged baseline tests still pass.

## 2 — GREEN
1. In the pure M09 Profit reader, skip vendor rows passing original `isDeleted_` semantics.
2. Skip expense rows passing the same original semantics before existing Cancelled and date checks.
3. Preserve full snapshot validation, settled discount model, return quantities and FIFO coverage; no cache, D1 or public RPC.
4. Verify focused suite, complete Node suite, frozen-source checksum and current-head GitHub CI.

## 3 — Review and merge
1. Confirm current M02/M03 open PRs still do not touch any of these four M09 paths; check complete diff against latest main.
2. Open one PR with exact RED/GREEN evidence, original source refs and remaining production gates.
3. Require all exact-head GitHub Actions and review/protection before merging, with no bypass. Verify code and tests on main; update #431.

**Rollback:** revert four M09-only files. No database/data rollback.
