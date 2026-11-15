# M07-A3 — Atomic Cash Return batch, test-only D1 design

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `SalesReturn.gs::completeReturnBatch` and M07 source contract. No source bytes modified.

## Problem
Original batch accepts 2–20 contributing invoices of the same named Customer, no duplicate or walk-in, refuses `Payment Detail Version='1'` (split-payment), and limits to 100 product lines. Each child remains its own Sales Return with original source invoice; Batch ID only groups records. Legacy GAS can leave partial writes and require manual review after a mid-batch failure. D1 should prove an all-or-nothing claim without changing source UI or inventing a second correction engine.

## Decision
**Bounded synthetic Cash-only proof**, using merged M06 + M07 local Workerd/D1 fixtures. Every input child is *exactly one standard owned-SKU line*, with explicit source `m06_invoices` receipt hash and synthetic one-lot evidence. Consequently 2–20 contributing invoices also means 2–20 lines; the 100-line original-source cap remains separately characterized and **is not demonstrated by this proof**. Add a disposable `m07_batch_source_policy` provenance table marking original `Payment Detail Version` as `legacy` or `1`, because synthetic M06 receipts do not retain that source field; never infer eligibility from the number of M06 tender children. Only `legacy` is accepted.

One test-only `createSyntheticD1CashBatchReturnContract(DB).post(input)` accepts trusted tenant/actor, `batchId`, `operationId`, one exact `customerId`, reason, and child return descriptors. Canonical M03 operation digest binds every exact child, price, source hash, customer and actor. A **single guarded parent INSERT** commits `m07_cash_batches`; its SQLite AFTER INSERT trigger verifies original invoice/lot, source-legacy tender version, reviewed selected Customer link, session and individual price, then inserts each child through existing `m07_cash_returns`/stock/refund trigger and records each `m07_cash_batch_members` link. Failure anywhere aborts **parent + all children + all cash and stock writes**. Replay is parent-only; changed content/actor, child IDs reused in a Cash/Store Credit return, or competing last unit must not create double posting. All IDs scoped by tenant.

Ruling: synthetic batch IDs are caller-supplied, while original `deriveSalesReturnBatchId_` derives from first allocated child. This test verifies **group metadata and atomic behavior, not production ID allocator parity**. Real integration must use original ID policy after counters have a reviewed atomic D1 owner.

## Scope and rejection
No Store Credit batch (running signed balance is separate M08-owned decision); no generic reversal engine, real RBAC, M05 purchased-lot provenance, vendor/bundles/OVERSOLD, multi-line/multi-unit, historical date policy, real Cash/Bank session journal, deployment schema, Worker endpoint, original HTML change or public RPC. No source-first batch UX switch. Revert PR to discard fixture only.

## Acceptance
Local real Workerd/D1 tests: two Cash child returns preserve distinct source IDs and Customer due, 2–20 and duplicate/split/walk-in/mismatch rejects, idempotent replay/conflict and cross-method child reuse, last-unit concurrency, Cash Session closed before claim, second-child forced refund/stock movement failure rolls back first child, forged/missing source provenance declines, and no exposed endpoint. Full existing tests must remain green.
