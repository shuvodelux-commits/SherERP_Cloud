# M08 Internal Cash Read Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Each step must be independently evidenced.

**Goal:** Port two read-only source-faithful Cash Book / Cash Session calculations without enabling financial operations.
**Architecture:** A side-effect-free internal module consumes preloaded, *already active-filtered* rows; original legacy GAS VM is the source parity oracle. No D1/RPC wiring.
**Tech Stack:** Node >=22 ESM, node:test; existing Acorn-based source test VM.
**Spec:** `docs/superpowers/specs/2026-11-15-m08-internal-cash-read-projection-design.md`

## Global constraints
- Immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; do not edit `legacy/source`.
- No `src/db`, `src/index.js`, `src/rpc`, SQL, auth, preview config or frontend modifications. No cash/bank/Party mutations.
- GitHub branch/PR only; real Workerd+D1 authorization, posting and settlement remain gated; original Cash Book sign **Credit in, Debit out**.

## Review focus
- Backdated transactions posted after marker still count even if dated before session open.
- Historical cash openings affect book balance but not current drawer turnover.
- Reconciled explanation entries are not counted a second time.
- Soft-deleted cash rows must be filtered upstream; no reliance on stale stored Balance.
- Async repository leakage (Promise instead of array) must be rejected, not treated as empty data.

## Task 1 — RED source parity and acceptance tests
**Create:** `tests/m08-internal-cash-read-projection.test.mjs`.
**Interface:** imports `cashBalance(activeCashRows)` and `cashSessionSnapshot(session, sessionRows, activeCashRows)` from `src/modules/m08-cash-read-model.js`.
- [ ] Write expected manual values, source VM oracle comparisons, closing + invalid/async input tests.
- [ ] Open draft PR to trigger GitHub Actions at test-only commit; record RED failure due to missing module.

## Task 2 — GREEN minimal pure implementation
**Create:** `src/modules/m08-cash-read-model.js`.
- [ ] Implement source-compatible rounding, explanation ID handling, book balance and session snapshot with arrays validated before reduction.
- [ ] Preserve exact original output shape and calculation order. Do not add storage or API.
- [ ] Run focused tests; review RED→GREEN, trim unnecessary abstraction.

## Task 3 — Verify and submit
- [ ] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m08-finance.mjs --check`, `git diff --check` using CI evidence or isolated environment.
- [ ] Rebase/merge latest main into branch without altering other workstreams; verify PR diff, CI and source pin.
- [ ] Submit for owner review; do not merge without approval and no deployment/financial activation. Document residual D1 posting requirements.
