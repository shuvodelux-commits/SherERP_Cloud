# M03 Exactly-One D1 Batch Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with TDD (RED/GREEN), task by task.

**Goal:** Build and verify a reusable internal D1 batch assertion that turns silent zero-row writes into full-transaction rollback.
**Architecture:** A fixed row-count SQL gate is interleaved after each pre-bound D1 DML operation and executed through one D1Database.batch transaction. Synthetic, nondeployable Worker+D1 fixture demonstrates replay/collision and multi-step rollback without any financial schema or public RPC changes.
**Tech Stack:** Node 24 ESM, node:test, node:sqlite, pinned Wrangler local workerd.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-exactly-one-batch-guard-design.md`

## Global Constraints
- No production D1 schema migrations or live backend posting.
- All SQL in runtime guard fixed. Only accept internal pre-bound D1 statement objects, never raw strings or HTTP inputs.
- Never claim helper alone gives idempotency; stable operation ID and matching fingerprint are separate responsibilities.
- No GAS LockService fake; no cross-request cache; preserve original frontend and GAS.

## Review Focus
1. Legitimate synthetic multi-step operation updates stock and journal once.
2. Zero affected row in mid-batch rolls back earlier successful op claim.
3. Duplicate operation ID cannot change stock/journal; mismatched fingerprint must be detectable by explicit receipt reconciliation.
4. Concurrent operations for one final stock unit: exactly one commits, one rolls back.
5. Multirow update accidentally changes 2 records: aborts and rolls back all prior statements.

### Task 1 — Internal guard TDD
**Files:** `tests/m03-exactly-one-batch.test.mjs`, `src/db/exactly-one-batch.js`.
**Contract:** `createD1ExactlyOneBatchGuard(env).execute_(preboundStatements): Promise<void>`.
- [ ] Write Node SQLite transaction shim tests, verify RED with missing module.
- [ ] Implement strict D1 binding/array validation and fixed interleaved gate statement.
- [ ] Observe targeted GREEN and regression suite.

### Task 2 — Local real workerd+D1 tests
**Files:** `tests/fixtures/m03-exactly-one-worker.mjs`, `wrangler.m03-exactly-one-test.jsonc`, `tests/integration/m03-exactly-one-workerd.spec.mjs`, `tests/integration/m03-workerd.spec.mjs`, `docs/M03_EXACTLY_ONE_BATCH.md`.
- [ ] Write real Worker tests, first RED absent route.
- [ ] Add fixed, synthetic-only test route and test database tables (CREATE statements run in test harness, not production migrations).
- [ ] Exercise success, same-ID replay, changed-payload collision, last-stock concurrency, insufficient stock, forced journal constraint failure, and multirow guard.
- [ ] Run full npm test, full workerd entry, original source verification, frontend build, M03 caller inventory and syntax/diff checks.
- [ ] Rebase on main, repeat full checks, open PR; do not merge or enable production RPC.

## Completion contract
Only claim observed green test counts and local transaction semantics. Shared financial kernel and authenticated RPC remain blocked.
