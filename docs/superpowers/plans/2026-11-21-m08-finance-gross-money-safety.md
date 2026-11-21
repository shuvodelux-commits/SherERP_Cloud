# M08 Finance Gross Balances — Exact Money Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task; RED failing test → minimal GREEN implementation → refactor → full retest.

**Goal:** Prevent coercion, float precision loss and unsafe gross-account aggregation in the existing Owner/Lender/Borrower source projection without altering its API, ordinary source rounding, independent account roles, current cash, or backend writers.

**Architecture:** Keep `projectFinanceRoleBalances(rows,{personId})` as a pure, read-only, source-keyed calculation. Validate original money text/number without JavaScript coercion; maintain signed balances in exact integer paisa with source-compatible half-up/toward-+∞ rounding of per-row deltas, and fail closed on overflow before converting normal supported values to the historical numeric output shape. Reuse the existing nine source transaction effects. No DB calls or UI changes.

**Tech Stack:** Node ESM, `node:test`, JavaScript BigInt internal integer cents, pinned FinanceModule test-oracle.

**Spec:** `docs/superpowers/specs/2026-11-15-m08-finance-role-balance-design.md`; `docs/architecture/ADR-007-unified-party-relationships.md`.

## Global Constraints
- Workstream M08, issue #66. Branch `m08/finance-gross-balance-exact-money-guard`; base main `9670c5e2947a35a5e7d31c84c2aea36af1b83a46`.
- Modify only `src/modules/m08-finance-role-balances.js`, new `tests/m08-finance-role-money-guard.test.mjs`, this plan. No M03 Worker, `src/db`, migration, shared RPC, frontend or production Cloudflare.
- Retain the original nine transaction signs, source-defined per-row `roundMoney_` behavior, six *gross* buckets, exact original Person ID filtering, and existing public output shape.
- Do not change old customer/finance data or create cash/bank/drawer entries; never infer Party links by name/phone.
- A type or monetary amount that cannot be proven safe must throw; do not show a partially computed balance.

## Review Focus
- Boolean, null or blank finance amount must not be silently converted to ৳0 or ৳1.
- Fractional-cent source evidence such as `0.105` must round per movement with source's signed direction, not be dropped or rounded only at summary end.
- A Person ID with hidden leading/trailing whitespace must not be silently grouped with the canonical ID.
- Accumulation past safe integer paisa must fail before any displayed gross bucket is wrong.
- Two persons with equal names and independent lender/owner/borrower positions must not net or merge.

## Task 1 — Guard and account arithmetic

**Files:** create `tests/m08-finance-role-money-guard.test.mjs`; modify `src/modules/m08-finance-role-balances.js`.

**Interfaces:** preserve `projectFinanceRoleBalances(activeFinanceRows,{personId}={})` returning `{byPerson,summary}`. No new deployed API.

- [x] Write focused failing tests for null/boolean/blank/scientific values, noncanonical Person ID, unsafe single-account and gross-summary accumulation, and valid zero/decimal rounding including negative credit.
- [x] Run new tests and record expected RED (the current `Number(value)` accepts coerced input).
- [x] Replace float accumulation with bounded signed paisa arithmetic; validate each raw value before iteration, preserve source per-row rounding and six gross buckets. Throw `TypeError` when input money or accumulated cents are untrustworthy.
- [x] Run new guard tests, existing `tests/m08-finance-role-balances.test.mjs` and `tests/m08-finance-person-balance-reconciliation.test.mjs`; keep pinned source oracle parity.
- [x] Review for unnecessary code, run `git diff --check`, `npm run verify:source`, full affected finance tests and `npm test` if resources permit. Record source verify 84/84, docs check and M08 239/239. Full repository `npm test` result is recorded in PR after bounded run.
- [ ] Commit on isolated branch, open scoped PR; record base/head, test output, no live D1 evidence, release gates and rollback.

## TDD evidence (21 November 2026)

- RED (baseline main): 4 guard tests failed (coerced amounts, noncanonical IDs, unsafe display paisa, gross overflow) and 2 existing-parity guard examples passed.
- GREEN (isolated worktree): 29/29 focused finance role + reconciliation + new guard tests; 239/239 all M08 module/contract tests.
- `npm run verify:source`: 84 pinned files verified. `npm run docs:check`: passed. No SQL or production D1 writes.
- The exact eight-sheet/finance source read and cash/bank current-day effects remain independent; this is a **read-only** finance projection guard.

## Merge and rollback
PR targets `main` after green CI and human review; do not merge merely because isolated projection tests pass. Rollback is revert of this PR. M03 alone may later integrate a financially reconciled source-backed projection through authenticated read APIs. Historical Source/D1 import remains separately gated.
