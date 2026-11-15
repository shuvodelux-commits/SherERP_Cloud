# M08 Internal Bank Ledger Read Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checklist tracking.

**Goal:** Implement pure source-faithful bank balance and ledger statement projections without enabling financial mutations.
**Architecture:** Frozen GAS source is test oracle via explicit test-only VM allowlist. New internal ESM module consumes preloaded, date-normalized rows, returns ledger data without DB, auth or RPC dependencies.
**Tech Stack:** Node >=22 ESM, `node:test`, existing Acorn source runner and GitHub Actions CI.
**Spec:** `docs/superpowers/specs/2026-11-15-m08-internal-bank-ledger-design.md`

## Global constraints
- Frozen source pin `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains immutable.
- No financial write, no D1 or public RPC, no new dependency, no duplicate journal engine, no changes to shared M03 kernel.
- Bank Debit = out; Credit = in. No unrelated accounts mixed into one statement.
- All Bank Book dates provided to the pure model must be canonical `YYYY-MM-DD`; explicit `today` prevents server timezone guesswork.

## Review focus / likely failure modes
- **Backfill**: opening account field + Bank Book Opening Balance row must not both count.
- **Manual reversal vs deletion**: mirrored Reversed original retained; unmirrored Reversed original excluded.
- **Cross-account isolation**: another account's entries/reversal references never affect this account.
- **Sorting and date bounds**: running totals chronological, display newest-first; reversed range swaps/defaults.
- **Reconciliation**: stored account balance disagreement reported as drift, not silently corrected.

## Task 1 — RED source behavior tests
**Files:** `tests/m08-internal-bank-read.test.mjs`; modify M08-only test fixture `tests/fixtures/m08-legacy-source-runner.mjs` allowlist for `BankLedger.gs`.
**Functions under test:** `bankCurrentBalance(bankAccountId, accounts)`, `totalActiveBankBalance(accounts)`, `bankStatement(account, bookRows, {from,to,today})`.
- [ ] Write source-oracle and independent expected-value tests for account balances, historical opening backfill, matched and unmatched reversals, cross-account isolation, date range, reconciliation and invalid inputs.
- [ ] Open draft PR for RED GitHub Actions evidence; expected failure: `ERR_MODULE_NOT_FOUND` for `src/modules/m08-bank-read-model.js`.

## Task 2 — GREEN minimal internal implementation
**File:** create `src/modules/m08-bank-read-model.js`.
- [ ] Implement bank current and total balance selectors using stored account rows and source rounding.
- [ ] Filter, normalize (canonical date only), sort, reverse-target classify and project ledger with exactly original output fields and arithmetic.
- [ ] Enforce loaded-array/type checks and no mutation. No I/O or public routes.
- [ ] Run focused GitHub Actions `npm test` and exact source parity tests, update based on source-led behavior only.

## Task 3 — verification and integration handoff
- [ ] GitHub source/build, local Workerd CI and Chromium checks pass; verify focused test results and 84-file pinned original manifest.
- [ ] Confirm diff exactly M08 files and no unrelated mutations; recompare against newest main.
- [ ] Mark draft PR ready and document RED→GREEN, file/RPC/table impact, live D1 gaps, rollback, review and merge sequencing. No unreviewed merge.

**Deferred:** Bank Book/Bank Transfer real D1 writes, authorization, external connections, journal schema and all financial settlement, which require M03/M04/M06 signed-off interfaces and live D1 failure/retry/concurrency tests.
