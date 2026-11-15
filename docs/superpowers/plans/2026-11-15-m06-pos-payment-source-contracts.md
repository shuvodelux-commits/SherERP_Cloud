# M06 POS / Sale Payments Source-Parity Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the original M06 split-payment semantics as runnable, source-verified characterization tests without writing financial records.

**Architecture:** Load the exact pinned `SalePayments.gs` source in a test-only Node VM; check its Git blob identity, expose five pure/read-only native helpers to assertions, record the future D1 integration gates in a design spec. Neither test adapter nor the original GAS source is imported by `src/`.

**Tech Stack:** Node 22+ built-in `node:test`, `node:assert/strict`, `node:vm`, `node:crypto`; existing unchanged Cloudflare Workers/D1 target.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-pos-payment-source-contracts-design.md`.

## Global Constraints

- Preserve `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` exactly. Never change `legacy/source`.
- No `src/db`, `src/auth`, `src/rpc`, `migrations`, `wrangler*`, original UI, deployment or remote D1 changes in this PR.
- No independent financial writes, no anonymous Party creation, no cross-role offset.
- Share no mutable worktree with M05/M08; PR remains unmerged until review.

## Review Focus

- Floating point/three-decimal tender rejected; exact paisa sums retained.
- Cash change remains tender metadata even when entirely returned; not book income.
- Inactive/wrong-type bank or mobile account rejected; no implicit fallback to Cash.
- Legacy invoice fallback is not a synthetic v1 child/backfill; corrupt v1 child state must fail closed.
- Interrupted posting states are NOT valid same-operation replay.

---

### Task 1: Test native payment reference without activating it

**Files:**
- Test: `tests/contract/m06-sale-payment-source.test.mjs`
- Create: `tests/fixtures/m06-payment-source-oracle.mjs`

**Interface:** `createNativeSalePaymentOracle() -> {origin, normalize, breakdown, accountDeltas, assertBookEvidence, journalDecision}` (test-only; no network, DB or Worker import).

- [x] Write initial source-payment characterization tests with a missing oracle import.
- [x] Run `node --test tests/contract/m06-sale-payment-source.test.mjs`; expected RED `ERR_MODULE_NOT_FOUND` for the new adapter.
- [x] Implement minimum test-only oracle reading the pinned file and validating exact Git blob SHA.
- [x] Run targeted tests; expected 0 failed, with cash+bank, mobile due, exact paisa, bad account, legacy/v1 children, account-delta, cash/bank evidence and operation replay cases.
- [x] Run after subsequent test additions: 13/13 native-source tests passed.

### Task 2: Record safe boundaries and acceptance gates

**Files:**
- Create: `docs/superpowers/specs/2026-11-15-m06-pos-payment-source-contracts-design.md`
- Create: this plan.

- [x] Trace original `Sales.gs`, `SalePayments.gs`, `SalesManagement.gs`, `DraftSales.gs`, `Invoice.gs`, `CashSession.gs`, `StockLots.gs`.
- [x] Document source contract, Party identity constraints, session behavior and M03/M04/M05 gates.
- [x] Verified only the two new test files and two design/plan docs are changed; no production binding.

### Task 3: Whole-repo checks and review handoff

- [x] `node --test tests/contract/m06-sale-payment-source.test.mjs` — 13 passed, 0 failed.
- [x] `npm test` — 270 passed, 0 failed (baseline: 257).
- [x] `npm run verify:source` — 84 original source files verified unchanged.
- [x] `npm run build:frontend` — 36 includes assembled; RPC shell patched.
- [x] `git diff --check`, staged diff and status — only the approved four new files.
- [ ] Commit only test/docs changes; push `m06/pos-sales-source-contracts-20261115`; open a **draft**, non-merging PR identifying blocked real-D1 acceptance work.

## Next M06 increments (separate owner-reviewed PRs, NOT authorized by Task 1)

1. M06-2 — after M03/M04/M05 gates, design D1-backed, SQL-guarded sale posting against shared kernel with real D1 RED→GREEN concurrency/rollback evidence.
2. M06-3 — approved split/single payment compatibility, durable invoice/child/receipt posting, Cash Session and Party AR reconciliation.
3. M06-4 — source-shaped draft replay, POS V2 browser/print parity and sales management; return/reversal implementation belongs to M07's separately reviewed lane.

**Do not mark M06 complete based on test-only native source parity.**
