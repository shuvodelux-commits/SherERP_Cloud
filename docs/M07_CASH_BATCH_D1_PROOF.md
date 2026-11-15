# M07-A3 — Multi-invoice Cash Return atomicity in local Workerd/D1

**Status:** local TEST-ONLY synthetic D1 proof, not production M07, staging D1 migration, browser feature or enabled `completeReturnBatch`. Frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Prior proofs: M07 Cash #79 and Store Credit #89. `PARALLEL-MODULE-READY=false`.

## Source fidelity and bounded divergence

Original `SalesReturn.gs::completeReturnBatch` requires **2–20 distinct contributing invoices** of one non-walk-in Customer, rejects `Payment Detail Version='1'` split-payment invoices, caps 100 lines, and creates individual native return IDs with a group `Batch ID`. Cash refunds make outgoing Cash Book debit entries and **do not modify Customer due**. A batch must not post early children if a late child is invalid; original GAS acknowledges a possible partial write and manual review, but D1 should guarantee a truly atomic operation.

This **bounded** proof supports one original standard owned SKU per invoice, one source-proven synthetic lot, one Cash refund and one child line. Thus max **20 lines** are supported here, and the original **100-line** cap **is not yet covered** by this synthetic M06 model; do not present this as full batch parity. `Payment Detail Version` is represented by explicit, **manually seeded** synthetic `m07_batch_source_policy` (`legacy` vs `1`), not inferred from tender count. Original `deriveSalesReturnBatchId_` derives the Batch ID from the first generated Return ID; test helper takes a preallocated batch ID and checks only grouping/atomicity—not production counter allocation.

## Internal D1 interface, tables and write boundary

`tests/fixtures/m07-cash-batch-contract.mjs` exposes **test-only** `createSyntheticD1CashBatchReturnContract(DB).post(input)`, with trusted test actor, tenant and exact input shape: `{tenantId,actorId,batchId,operationId,customerId,reason,children}`; children contain `{invoiceId,returnId,operationId,sku,lotId,originalHash,units,refundPaisa}`. Its canonical M03 digest covers the actor, customer, group and all child intent. Result: `COMMITTED|REPLAY|CONFLICT|DECLINED`; ambiguous D1 errors yield `NEEDS_REVIEW`.

Disposable local-only tables: `m07_batch_source_policy` (legacy sale Payment Detail Version provenance), `m07_cash_batches` (immutable stable batch receipt, JSON child intent) and `m07_cash_batch_members` (original invoice ID/child Return ID/grouping). A **single INSERT** into the parent table is guarded by an SQLite BEFORE INSERT trigger that declines missing/closed session, duplicate invoice IDs or child identities, mismatched original receipt hash or Customer, missing source-lot evidence, insufficient outstanding return quantity, unsupported original Payment Detail Version, nonreviewed exact Customer Party link, bad price ceiling, already-used child ID/operation ID across Cash/Store Credit, and an already-used parent operation ID across individual Cash/Store Credit.

The SQLite AFTER INSERT trigger **inserts all native Cash child receipts** into the merged `m07_cash_returns` table, invoking its existing stock/lot restoration, movement and Cash refund trigger, then inserts each `m07_cash_batch_members` record. An INSERT failure at the second child aborts the entire parent SQL statement and rolls back **every earlier child Cash/refund/movement/stock mutation**. Parent and child receipt rows are immutable. The individual source-linked M06 invoice, Customer due and Supplier AP stay unchanged.

**No** JS loop with asynchronous independent child commits; no test Worker endpoint; no actual signed Store Credit batch; no shared production posting kernel, new migration, secret or remote D1.

## Superpowers RED → GREEN / test evidence

- **RED 1:** new test `tests/integration/m07-cash-batch-workerd.spec.mjs` failed with `ERR_MODULE_NOT_FOUND` for missing Cash batch schema/contract before implementing the D1 proof.
- **GREEN 1:** first local real Workerd/D1 run reached **11/12**; the remaining case was an invalid fixture (an unpaid anonymous sale) and was corrected to a fully paid original walk-in sale. Result **12/12**.
- **RED 2:** new case showed same operation ID from a different individual Cash return could wrongly commit a batch. Observed actual `COMMITTED` against expected `DECLINED`. SQL BEFORE INSERT guard now checks existing single Cash/Store Credit operation IDs. **GREEN 2:** local real Workerd/D1 focused suite **13/13**.
- Cases include legitimate 2-invoice grouping and refund exactness, immutable parent replay and changed payload conflicts, 1/21/duplicate contributor rejections, walk-in and mismatched Customer rejection, original Payment Detail Version `1` split-tender rejection, stale hash/forged lot/reviewed Party, Cash Session race, late Cash refund and movement fault complete rollback, concurrent competing batches, individual return collision and global parent ID collision, hostile shapes and 404 test endpoint.
- Existing M07 Cash and Store Credit suites plus full Node/source/build checks are separate regression gates; GitHub PR CI is authoritative for combined Workerd regression status.

## Noncoverage / acceptance gates / rollback

Still blocked: original multi-line/100-line batch and per-line discount/lot consumption, Store Credit batch with signed running balance, M04 authenticated actor/permission version in same SQL, real M05 source lot/OVERSOLD/vendor/bundle, real M08 Party accounts and cash-session/ledger, original historical dates/permissions, full native UI/RPC and original `SalesReturn.gs` per-child result shapes. No `src/**`, `migrations/**`, `src/rpc/**`, `legacy/source/**`, production Wrangler or public route changes. Revert this PR to remove disposable tests/docs only; no remote DB or production money is written.
