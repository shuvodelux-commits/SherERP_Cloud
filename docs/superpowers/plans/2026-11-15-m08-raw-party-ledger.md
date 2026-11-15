# M08 Customer/Supplier Raw Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Follow RED → GREEN → refactor → verify with each task checkbox.

**Goal:** Implement a pure read-only source-faithful Customer/Supplier raw ledger index without collapsing role accounts.
**Architecture:** Original pinned `partyLedgerBuildAscendingIndex_` is run under the test-only M08 VM; new internal code projects the same signed/ordered rows from preloaded data and never runs D1/permission/RPC logic.
**Tech Stack:** Node >=22 ESM, `node:test`, current test-only Acorn VM oracle, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m08-raw-party-ledger-design.md`

## Global constraints
- Source SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` unchanged; branch from latest `main`, PR only.
- Exact source Customer/Supplier IDs, sign convention `Debit - Credit`, deleted-flag logic, business-date/row order; no assumed identity matches or cross-role offsets.
- M03 exclusively owns `src/db`, migrations, atomic posting; M04 owns staff auth; M06 posting dependency blocked; M08-S disabled.
- No runtime RPC/UI/Cloudflare changes, no financial writes, no invented seven-role current-due field.

## Review focus
1. Same-name/same-phone Customer and Supplier row IDs never join or net.
2. Positive/negative signed due is preserved, including advances.
3. Soft deletion removes only literal source-compatible true/TRUE.
4. Business date then row index orders same-day audit correction entries; Created At is not a tiebreaker.
5. Promise and unsupported role must fail closed rather than silently become an empty ledger.

## Task 1 — RED source and tests
**Files:** create `tests/m08-raw-party-ledger.test.mjs`, change `tests/fixtures/m08-legacy-source-runner.mjs` **only** M08 allowed-source set.
**Interface:** import `projectRawLegacyPartyLedger(kind,legacyId,rawRows)` from missing `src/modules/m08-party-raw-ledger.js`.
- [ ] Test hardcoded signed balances, indexes, customer/supplier isolation, soft deletion, sorting, correction entry persistence, immutable inputs and refusal of invalid/kinds/async rows.
- [ ] Execute exact frozen GAS `partyLedgerBuildAscendingIndex_` plus `isDeleted_` in synthetic VM to compare independent expected outcomes.
- [ ] Draft GitHub PR at RED test-only head. Record expected `ERR_MODULE_NOT_FOUND` from Foundation CI as objective RED proof.

## Task 2 — GREEN smallest source-faithful code
**File:** create `src/modules/m08-party-raw-ledger.js`.
- [ ] Validate allowed role kind and explicit source ID, loaded array; do not load or mutate.
- [ ] Filter source `Is Deleted`, filter exact matching source ID, sort by original `_stableKey`, increment source `roundMoney_` in Credit/Debit order.
- [ ] Return `{kind,legacyId,rows,closingBalance}`; no mutation or network/database/permissions.
- [ ] Confirm focused tests and `npm test` in GitHub CI and fix source parity defects under RED→GREEN, not by altering tests to match implementation.

## Task 3 — verify / review / integration sequencing
- [ ] Full `npm test`, pinned `npm run verify:source` (84 files), existing frontend build and Github Workerd browser tests pass.
- [ ] Compare against latest main and sync non-overlapping concurrent changes, rerun PR CI, inspect exact file diff.
- [ ] PR documentation: file/RPC/table impact, immutable source SHA, RED/GREEN logs, per-account gross balance limits, M02-P/M03/M04/M06 gates, rollback = revert small pure module/test/docs commit.
- [ ] Mark PR ready for **owner** review only, do not auto-merge this next PR.

**Out of scope:** Source Business Ledger clean display, invoice gross payment projection, Vendor ledgers, Finance Owner/Lender/Borrower actual contract accounts, Party link import, no net settlement, real accounting D1, auth/RPC endpoints, cash/bank posting.
