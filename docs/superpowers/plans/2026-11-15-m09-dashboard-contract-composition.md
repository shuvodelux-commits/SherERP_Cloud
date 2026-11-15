# M09 Dashboard Contract Composition — Superpowers RED/GREEN Plan

**Spec:** `docs/superpowers/specs/2026-11-15-m09-dashboard-contract-composition-design.md`  
**Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `Dashboard.gs`, `Utils.gs`.  
**Goal:** deliver full exact 11-key source-compatible Dashboard response **without** activating RPC/SQL or duplicating Finance/Cash accounting logic.

## Task 1 — RED original source executable oracle
**New file:** `tests/m09-dashboard-contract.test.mjs`.
- [ ] Execute original `getDashboardStats` with original dashboard helpers, native discount/rounding/duplicate guard in Node VM; inject trusted stable data, finance summary, cash and Settings currency.
- [ ] Test entire output value + key order, live Finance/Cash passthrough (including negative cash), source returns and settlement discounts, role gross balances and stock flags, shop-local date, blank Unicode currency.
- [ ] Reject omitted finance/cash/currency, malformed row/date/summary, Promise/accessor, non-finite inputs; don't read env/time state or mutate input.
- [ ] Commit tests alone, open draft GitHub PR, capture CI expected missing-module failure (RED).

## Task 2 — GREEN single small internal pure composer
**New file:** `src/modules/dashboard-contract.js`.
- [ ] Validate own-data trusted input/finance summary/cash/currency before computation; reject unknown/invalid values, no hidden finance default.
- [ ] Call existing `projectDashboardDailyActivity` and `projectDashboardDueStock`, return exact original `getDashboardStats` 11-key order with upstream numeric Finance/Cash values.
- [ ] Verify full Node suite, `verify:source`, original frontend build, browser print/mobile/desktop, existing real-local-D1 auth/Party/read-only tests via exact-head GitHub Actions. Document CI separately.

## Task 3 — Review + handoff
- [ ] Review source diff (spec/plan/test/module only), record original file/RPC/table/permission impact, evidence RED/GREEN, unresolved D1/finance read integration gates and rollback.
- [ ] Keep PR draft for owner review; no unapproved live finance reads, schema changes, preview D1 binding or auto-merge.

**Permissions:** future caller must check `dashboard:view` and provide active records. This module grants no permissions.  
**Finance risk:** existing Owner/Lender/Borrower read models remain authoritative; no Customer/Supplier netting.  
**Rollback:** remove the four added files; no schema/data migration.
