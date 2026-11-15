# M07-A4 — Atomic multi-invoice Store Credit D1 proof (test-only)

**Status:** isolated local Workerd/D1 synthetic test, **NOT** production `completeReturnBatch`, NOT a D1 migration or authorized Party ledger, NOT M07 complete. Original frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains unchanged. Depends on merged M07 Cash #79, Store Credit #89 and Cash batch #110. `PARALLEL-MODULE-READY=false`.

## Preserved original business meaning

Original `SalesReturn.gs::completeReturnBatch` groups **2–20 distinct original invoices** belonging to the *same existing Customer ID*. It refuses blank/walk-in, mixed Customer and `Payment Detail Version='1'` original invoices. Refund method `Store Credit` produces one linked child Sales Return per original invoice, with signed customer `Current Due_after = Current Due_before - child total credit`, one `CUSTOMER_LEDGER` Credit row per child with **the running post-child Balance**, and **no Cash/Bank transaction**. Negative Customer due means an advance; do not truncate it. Original source also supports up to 100 item lines and derives Batch ID from the first allocated Return ID.

Here, synthetic M06 only contains **one owned SKU/one sale item/one original stock lot per invoice**. That means the new proof covers up to **20 item lines**, not full original 100-line, multi-unit, bundle, vendor/OVERSOLD, sale-time FIFO or original ID allocator parity. A synthetic source `m07_batch_source_policy` explicitly marks original invoice Payment Detail Version; no real D1 Sales import has been performed.

## Exact test-only interface and SQL boundary

`tests/fixtures/m07-credit-batch-contract.mjs` exports `createSyntheticD1CreditBatchReturnContract(DB,{beforeBatch?}).post(input)`. A trusted **test harness only** supplies `tenantId`, `actorId`, `operationId`, `batchId`, exact `customerId`, `reason` and 2–20 ordered children each with `invoiceId`, `returnId`, child `operationId`, `sku`, `lotId`, `originalHash`, `units` and integer `creditPaisa`. All fields are bounded and validated; canonical M03 operation digest binds every child and actor. Outcomes are `COMMITTED`, `REPLAY`, `CONFLICT`, `DECLINED`, or `NEEDS_REVIEW` on ambiguous errors.

`tests/fixtures/m07-credit-batch-schema.mjs` installs only **disposable local D1** `m07_credit_batches` (immutable parent operation receipt), `m07_credit_batch_members` (source invoice→return/group evidence) and SQL triggers. One guarded parent `INSERT` refuses invalid source Hash/Customer/Party link, closed Cash Session, reused batch/operation/child ID, missing/forged lot, returned quantity limit, original `Payment Detail Version='1'` and over-original-price credits. The AFTER INSERT trigger inserts all children into the merged `m07_credit_returns` table **in selected invoice order**. Its existing SQL trigger restores original synthetic lot and stock, moves the exact signed customer balance and writes a source-linked ledger row. Later child failure aborts the **single parent SQL statement and every prior child side effect**—no async loop with partial writes.

A secondary test-only guard prevents M07-A3 Cash batch from reusing an existing Store Credit parent batch ID or operation ID. The prior Cash batch writer responds `DECLINED` for a foreign method's ID; the new Credit batch writer's cross-method receipt readback responds `CONFLICT` when its parent ID is already used by a Cash batch. Neither status double-posts. This distinction is explicitly tested using **unrelated original invoices** so a depleted source is not mistaken for an ID guard.

The signed test account `m07_customer_signed_accounts` is a synthetic **oracle**, not a replacement source of production truth. The M06 `due_paisa>=0` account remains unchanged; M08 must reconcile the single authoritative signed Customer receivable/advance before cutover. No other Customer, Supplier, Cash, Bank or Vendor ledger mutation. No deployed Worker `/completeReturnBatch` route; local test Worker returns 404.

## TDD evidence (actual local Workerd/D1)

- RED: test file `tests/integration/m07-store-credit-batch-workerd.spec.mjs` was committed before contract/schema existed. Local `node --test` failed with expected `ERR_MODULE_NOT_FOUND` for `m07-credit-batch-contract.mjs`.
- GREEN first run: **12/13**, with only the expected different cross-method response status (`DECLINED` from unchanged prior Cash parent, not `CONFLICT`).
- Updated the test to explicitly verify both directions and unrelated invoice IDs; **14/14** tests pass against real local Workerd/D1.
- Coverage: selected Customer signed balance **20000→13000→5000** with two ordered ledger balances, fully prepaid original invoices yielding **0→-7000→-15000 advance**, no new Cash/Bank, no Supplier or unrelated Customer mutation, replay/changed intent and actor, contributor count and duplicate IDs, mixed Customer/walk-in and split tender exclusion, stale source hash/lot/Party mapping, closed session race, second-child injected ledger or stock fault full rollback, competing last-unit batches, cross-method parent IDs, invalid inputs and 404 route.
- Full repository verification and new GitHub Actions must be checked independently before integration.

## Gaps / deployment gate / rollback

Only internal local synthetic proof; M04 authenticated authority, M05 imported source lot provenance, M08 signed Party account writer, original Customer advance reconciliation, real Cash Session policy, source edit/delete and later settlements, 100-line and multi-unit batch, original dates/permission checks and UI/RPC remain unimplemented. No `src/**`, production `migrations/**`, original UI/source, Wrangler preview binding, secret or remote D1 data changes. Revert the PR to remove these isolated test-only files/imports, with no business write rollback required.

## Additional database-level regression (2026-11-15)

**RED:** A raw local D1 `INSERT INTO m07_credit_batches` with a child `operationId` equal to its own parent `operation_id` committed **17 affected rows** instead of being declined. The same invalid condition applies to a child `returnId` matching the parent `batch_id`. Relying on the JS input adapter alone would not guarantee unique financial identities.

**GREEN:** Added an explicit `json_each(children_json)` self-alias check in the **BEFORE INSERT SQL trigger**, returning `RAISE(IGNORE)` before any parent/child effect. Raw-SQL assertions now demonstrate zero D1 changes and an identical stock/customer/ledger snapshot for both colliding identity patterns. New focused Workerd/D1 suite: **15/15 PASS** after patch `ade9d50`. No production source/schema changes.

## Paid walk-in exclusion (additional source characterization)

Added a real local D1 test that first **posts** a fully paid anonymous Cash sale through the actual M06 synthetic sale contract, then tries to include its Invoice ID with a named Customer's Store Credit batch. The Store Credit batch is `DECLINED` and the complete stock, Cash/Bank and signed customer ledger snapshots remain unchanged. This is distinct from an invalid unpaid walk-in fixture: M06 correctly refuses an unpaid anonymous sale.

**Latest focused Workerd/D1 suite:** **16/16 PASS** on commit `8c2036e`, including the raw SQL parent/child ID guard. Prior **13/13 Cash batch**, **12/12 Store Credit single** and **11/11 Cash single** suites passed on the immediately preceding M07 branch revision; aggregate GitHub CI will rerun all current tests.

The unrelated full Node baseline currently contains M04 Settings authorization issue [#120](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/120) (`592/593` UTC test cases on the reconciled `main@de92eb4` branch). Do not mark full Node/CI green until fixed and rerun.
