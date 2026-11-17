# M07-B16 — Historical Mixed-Unit Purchase Return Batch Preflight

**Workstream/owner:** M07, issue #314, coordination issue #456. **Starting main:** `5ac51572cc3220480cd00841230f07df1c56d924`. **Status:** internal read-only proposal only.

## Implementation overview (12 sentences)

1. M07-B15 already reviews one historical mixed-unit Purchase Return using source-preserved M05 purchase unit and price snapshots.
2. B16 composes that existing return planner across two to twenty source-linked proposed children without inventing a second posting engine.
3. Each child must declare only its original source and narrowly shaped return intent.
4. All children must belong to the same explicit trusted tenant, with globally unique Return IDs.
5. For repeated historical Purchase/Product pairs, every child must carry an identical starting original source snapshot.
6. A private in-memory copy will accumulate the virtual `alreadyReturnedBaseQty` and purchase-owned lot consumption after each accepted plan.
7. The same saved historical unit row cannot be selected more times than its original recorded quantity across multiple children.
8. Unrelated Purchase IDs must not borrow each other's original lots even if their dates are earlier.
9. Conflicting source lot IDs or physical row indices between different purchase owners must fail closed.
10. Any child decline aborts the entire batch result without posting or promising a partially accepted batch.
11. The only success result is an immutable source-linked `PLAN_ONLY` preview with no Supplier, Cash/Bank, Party or refund authority.
12. Production purchase returns continue to require M02 provenance, M03 SQL-atomic idempotent stock/ledger reversal, M04 sessions/permissions, M05/M06 frozen contracts, M08 accounts, M10 reconciliation and release approval.

## Ownership and non-goals

**Exact files (M07-exclusive):**
- `docs/superpowers/plans/2026-11-17-m07-b16-purchase-batch-returns.md`
- `tests/m07-historical-purchase-batch-return.test.mjs` (RED before GREEN)
- `src/modules/m07-historical-purchase-batch-return.js` (created only after observed RED)

No edits to `src/db/**`, migrations, shared receipt or reversal kernel, `src/rpc/**`, Worker entrypoint/config, M05/M06/M08 source, original frontend or production/staging D1. No new dependencies. Frozen primary source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseReturn.gs`/`StockLots.gs`; approved optional multi-unit source `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`. Upstream #507 and #512 are merged directly to main.

## API and acceptance

`planHistoricalMixedUnitPurchaseReturnBatch({tenantId,batchId,entries:[{source,intent},...]})` is a pure in-memory, fail-closed internal function. A validated child is planned using merged `planHistoricalMixedUnitPurchaseReturn`. The first snapshot of each `tenantId|purchaseId|productId` pair is frozen as original evidence; later same-owner children must have the same source payload. Reserve exact persisted conversion-row counts as well as physical base quantities so that repeated Box/Pcs choices cannot be duplicated. Apply `sourcePurchaseLots` only to private copied physical rows with matching `lotId` and `sourceRowIndex`, retaining every other original-lot record untouched. Reject cross-tenant, duplicate return IDs, accessor-bearing or malformed untrusted inputs, stale/contradictory historical evidence, numeric overflow, cross-owner lot collisions and child declines. No partial result, SQL, RPC, refund, payment calculation, Cash Session claim, public endpoint or runtime database reservation.

## Superpowers RED → GREEN protocol

1. Branch from fresh main and commit this plan and tests *without* the implementation.
2. Confirm expected GitHub CI RED as a missing `m07-historical-purchase-batch-return.js` module (not a real ERP runtime defect).
3. Add the smallest pure composer after RED and confirm focused Node tests plus full exact-head GitHub checks (Foundation, source, six real local Workerd D1 shards, auth/security and Chromium/preview).
4. Keep the PR draft until full exact-head CI green, owner review and merge gate satisfied; recheck main/PR conflicts before merge.
5. Rollback: revert only these three M07 files, without data or schema changes.

**Risk:** a successful preview demonstrates only consistency of supplied historical snapshots, never durable concurrency protection, permission enforcement, physical stock CAS, exact-once financial reversal, invoice discount allocation or safe production activity.
