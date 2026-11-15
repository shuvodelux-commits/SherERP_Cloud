# M07-A3 Atomic Cash Batch D1 Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each behavioral task follows RED → GREEN → regression.

**Goal:** Demonstrate all-or-nothing 2–20-invoice Cash return batch in *real local D1*, linked to original M06 sale and M07 Cash child writer.
**Architecture:** One isolated test-only parent receipt/SQLite trigger posts all Cash children as one SQL statement; existing individual Cash trigger owns stock/lot/refund writes; a synthetic source `Payment Detail Version` marker makes the original split-payment exclusion explicit.
**Tech Stack:** Node ESM, Wrangler Workerd/D1, existing M06 and M07 synthetic fixtures.
**Spec:** `docs/superpowers/specs/2026-11-15-m07-cash-batch-atomic-proof-design.md`.

## Global Constraints
- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` source bytes unchanged.
- No `src/**`, `migrations/**`, production Wrangler/Worker/RPC, public D1, original UI or financial schema changes.
- Each child is one owned SKU with one synthetic original sale-time lot; original 100-line requirement still pending broader data model.
- Cash only; original Customer due, all Supplier/Owner/Loan/Vendor buckets never auto-net.
- Real D1 commit guard, stable operation replay and all-or-nothing failure. No JS preflight plus separate async child writes.
- One GitHub branch and scoped PR, with CI and review before merging.

## Review Focus
- Same Customer identifier but different Party mapping: fail closed.
- Second child failure after first child inserts: all earlier cash/lot/stock restored to original state.
- Original `Payment Detail Version='1'`, including one recorded payment: reject without trying to infer from tender count.
- Identical operation replay and differing child payload: no double return.
- A concurrent single return and batch of the same stock must serialize; no partial batch.

## Task 1 — RED integration acceptance
**Create:** `tests/integration/m07-cash-batch-workerd.spec.mjs`, `wrangler.m07-cash-batch-test.jsonc`, `tests/fixtures/m07-cash-batch-worker.mjs`.
- [ ] Create exact source-linked M06 sales and preseed explicit synthetic original lot + payment-detail version evidence.
- [ ] Test 2 original invoices one Customer and Cash effect, replay, duplicate invoices, walk-in, split-payment, original hash, closed Cash Session, second-child fault rollback and concurrent last unit.
- [ ] Run focused Workerd suite. Expected RED: absent `createSyntheticD1CashBatchReturnContract` implementation import.

## Task 2 — GREEN minimum atomic parent
**Create:** `tests/fixtures/m07-cash-batch-{schema,contract}.mjs`.
- [ ] Add three disposable test tables: original payment-version provenance, parent receipt and per-child batch grouping.
- [ ] Guard entire parent statement and use SQLite trigger to insert children through merged M07 Cash writer trigger.
- [ ] Reuse M03 canonical digest and classify `COMMITTED|REPLAY|CONFLICT|DECLINED`; throw NEEDS_REVIEW for inconsistent/error readbacks.
- [ ] Run all focused Workerd cases; resolve real SQL errors, do not relax security gates.

## Task 3 — Verify, PR, no deploy
**Modify:** one import in `tests/integration/m03-workerd.spec.mjs`. **Create:** `docs/M07_CASH_BATCH_D1_PROOF.md`.
- [ ] Run focused batch and previous Cash/Store Credit real Workerd suites, `npm test`, source-manifest verification, frontend build, syntax and diff checks.
- [ ] Run complete Workerd integration in GitHub CI (local memory-limited laptop aggregate may be insufficient).
- [ ] Publish scoped GitHub PR with RED/GREEN, source/RPC/table inventory and unchanged protected production paths.
- [ ] Leave PR open for review and no release claim.
