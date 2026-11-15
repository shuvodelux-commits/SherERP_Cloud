# M09 Daily Operational Dashboard Projection — TDD Plan

**Date:** 2026-11-15  
**Spec:** `docs/superpowers/specs/2026-11-15-m09-dashboard-daily-activity-design.md`  
**Source:** pinned `Dashboard.gs`, `Utils.gs`; `dashboard.html` DOM IDs and RPC names unchanged.

## Task 1 — Source-oracle regression suite (RED)

**File:** `tests/m09-dashboard-daily-activity.test.mjs`.

- [ ] Load original four helpers and `getDashboardStats` from frozen `Dashboard.gs` and rounding/return/duplicate helpers from frozen `Utils.gs`.
- [ ] Run source inside `node:vm` with deterministic shop-local today, explicit active-row fixtures and innocuous stubs for unrelated cards.
- [ ] Compare all four projected fields; include price basis/legacy discount, post-sale returns, later customer money and discount fallback, cancel/soft-delete responsibility, backdated business dates and cents.
- [ ] Reject duplicate selected invoice, invalid unnormalized date, invalid snapshot, data accessors/Promises, input mutation.
- [ ] Commit test first, open draft PR; capture expected fail on GitHub Actions.

## Task 2 — Pure projection adapter (GREEN)

**File:** `src/modules/dashboard-daily-activity.js`.

- [ ] Export `projectDashboardDailyActivity(snapshot,today)`. Validate trusted shop-local date using M09 `reportDefaultRange`, reject malformed/un-normalized active rows without inventing a timezone.
- [ ] Match pinned source's sale return pricing basis, POS+customer payment fallback/clamps, expense status, purchase totals and cents rounding in a small internal function; no new external deps.
- [ ] Duplicate invoice integrity check must mirror the selected-today guard against all active sales (not merely selected rows).
- [ ] Prove GREEN from new and full GitHub Actions suite; source verification, preview safety, browser and real local D1 checks should remain untouched/pass.

## Task 3 — Review and handoff

- [ ] Inspect PR diff, source-pinned evidence, exact-head GitHub checks and any unrelated failures.
- [ ] PR documents test-first RED/GREEN logs, effects (no D1 reads/writes, no public RPC, no Party combined balances, no frontend edits), rollback, remaining full-dashboard gate and authorizing future caller contract.
- [ ] Leave draft pending independent review; never auto-merge or call the M09 UI finished.

**Affected production file:** new internal `src/modules/dashboard-daily-activity.js` only.  
**No changes to:** GAS source, live `getDashboardStats`, permissions, `src/db`, `src/rpc`, Worker, Cloudflare config, SQL migrations, finance/Party settlement, report prints.  
**Rollback:** revert new module and isolated tests/docs; no data migration.
