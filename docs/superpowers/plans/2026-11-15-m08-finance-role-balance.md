# M08 — Source-faithful Finance Role Balance Implementation Plan

> **For agentic workers:** follow superpowers TDD RED → GREEN → refactor → verify, with source-derived tests and strict account ownership.

**Goal:** Pure internal Owner/Lender/Borrower signed balance projection from original, ID-bearing active Finance transaction rows.
**Architecture:** Explicit nine-type source contract; record-level per-account signed movement and gross positive/negative summary; original `financeSignedBalances_`/`financeBalanceSummary_` executed as source oracle in test-only Acorn/Node VM.
**Tech:** ESM Node >=22, node:test, existing M08 VM test loader, PR GitHub Actions.
**Design:** `docs/superpowers/specs/2026-11-15-m08-finance-role-balance-design.md`

## Task 1: RED tests from frozen source
**Files:** `tests/m08-finance-role-balances.test.mjs`; test-only allowlist change `tests/fixtures/m08-legacy-source-runner.mjs`.
- [ ] Assert source and hardcoded values for each of 9 original types; separate account buckets for same ID; no cross-person net; six gross summary buckets and negative values.
- [ ] Strictly reject missing Person ID and unauthorized identity resolution by name, missing/unknown transaction types, nonfinite or negative amounts, deleted source rows, Promise instead of loaded data and bad person selector.
- [ ] Audit opening rows as `cashDirection:'none'` with pure numeric position changes; no finance write or Cash Book call.
- [ ] Open draft PR at test-only head and capture GitHub Actions expected `ERR_MODULE_NOT_FOUND` RED evidence.

## Task 2: GREEN small pure code
**File:** `src/modules/m08-finance-role-balances.js`.
- [ ] Build source-faithful signed account movements for `owner`, `loanPayable`, `borrowerReceivable` with exact `roundMoney_` and per-person account isolation.
- [ ] Split positive and negative balances gross into `ownerCapital,ownerAdvance,outstandingLoan,lenderCredit,borrowerReceivable,borrowerCredit`. Use *trusted* Person ID only, no name matching, no accidental merging.
- [ ] No auth, SQL, permission, RPC or module cache. Do not mutate source rows. Run focused tests and correct only demonstrated parity issues.

## Task 3: verify, sync, PR
- [ ] GitHub Foundation `npm test`, `npm run verify:source`, `npm run build:frontend`; local Workerd M02/M03/M04/M01 CI as applicable. Clearly separate the M08 synthetic source proof from real D1 financial integration.
- [ ] Compare latest main; sync non-overlapping concurrent PR changes, rerun checks on exact latest head, record RED/GREEN and affected-file inventory.
- [ ] Mark PR ready for **owner review** after all checks pass. No merge, D1 posting, manual settlement or production authorization in this PR.

**Blocked:** Real M08 posted finance operations, imports, authenticated finance RPC, persisted Party account summaries, owner equity/loan obligation contract allocations, and M08-S cross-role settlement until M02-P/M03/M04/M06 explicit gates and owner review.
