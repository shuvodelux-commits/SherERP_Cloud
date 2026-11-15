# M07-A1 — isolated D1 Cash Return proof

**Status:** test-only; no deployed or authenticated return RPC, no production/staging D1 schema or data change, and no M07 release approval.

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Applies the [M07 source contract](M07_RETURNS_SOURCE_CONTRACT.md) to the merged M06 synthetic sale-posting fixture. The preserved source and original UI remain unchanged.

## Test-only interface and accounting scope

`tests/fixtures/m07-cash-return-contract.mjs` exports `createSyntheticD1CashReturnContract(DB,{beforeBatch?}).post(input)`, where `input` is an exact, bounded internal object with synthetic trusted `tenantId`, `actorId`, stable `operationId`/`returnId`, `invoiceId`, `sku`, original `lotId`, immutable `originalHash`, `units`, `refundPaisa`, `reason`. The actor and tenant **are not authenticated**; test callers are harness-controlled and no test Worker request routes to this helper. Return values: `COMMITTED`, `REPLAY`, `CONFLICT`, `DECLINED`, or thrown `NEEDS_REVIEW`.

**New disposable test-only D1 tables:** `m07_source_lots` (fake original owned-sale lot evidence and returned quantity), `m07_lot_stock`, `m07_cash_returns`, `m07_return_movements`, `m07_cash_refunds`. In one guarded D1 INSERT and SQL trigger the receipt, original lot returned quantity, `m06_owned_stock` restoration, source-linked inverse movement and positive/zero Cash debit commit or all roll back. An immutable receipt and canonical `sales.return.cash` intent digest guard retries; source invoice hash and line+movement evidence are checked in SQL. SQL quantity precondition is reasserted by a trigger update that cannot exceed original consumption.

**M06 integration:** Tests actually create original sale through existing `createSyntheticD1SalePostingContract` (not a newly invented sale fake); fixture then adds *explicit, synthetic* single-lot provenance because M06 does not yet record real M05 lot IDs. `m06_cash_sessions`, source receipt, `m06_sale_items`, `m06_stock_movements`, `m06_owned_stock`, `m06_customer_accounts`, `m06_supplier_accounts` are shared. Source Cash refunds may be paid even when invoice due remains unpaid; original Customer AR is **unchanged**, supplier payable is **unchanged**. Cash out is separately recorded in `m07_cash_refunds`; it does not masquerade as a sale-income row in `m06_cash_book`.

## TDD / real D1 evidence

- RED: missing test-only return contract import (`ERR_MODULE_NOT_FOUND`) in new integration suite.
- GREEN: `node --test tests/integration/m07-cash-return-workerd.spec.mjs`, **10/10 local Workerd/D1**.
- Cases: unpaid sale Cash refund; full physical lot quantity; original receipt replay and changed intent conflicts; two simultaneous last-unit return requests; stale original sale hash, unrelated lot, over-limit refund, tenant isolation; Cash Session closed before SQL claim; fault injection at Cash refund and stock movement each proves original stock/source receipt/ledger snapshot unchanged; receipt immutable; Worker has no return route; invalid input rejected.
- Only M07 local test files, this document and one aggregator import are changed. No `src/**`, `migrations/**`, D1 remote binding, `wrangler.preview.jsonc`, original GAS/HTML or Cloudflare deployment ownership change.

## Important gaps (do not overclaim)

1. **Not production M07**: M04 D1 authority/version checked at actual write, real M05 sale-time lots and FIFO, original UI/RPC payload, ledger/Party account schema, multi-unit, vendor/OVERSOLD, bundles, split-payment original and later settlements remain blocked. Current test has one standard owned SKU and manually seeded fixture lot; do not claim actual original lot parity.
2. Store Credit is **deliberately not implemented here**. Original source allows a negative Current Due/advance, but M06's synthetic Customer due has a `>=0` check and cannot represent it. Reconcile M08/Party account semantics before enabling this path; do not silently truncate credits.
3. Multi-invoice atomic return batches, Purchase Return, return edit/delete, Cash/Bank integration into production ledgers, audit actor, and receipt reconciling against real D1 source/legacy imports remain M07-A2/B/C/D/E.
4. No live/remote data writes; no proof of complete original transaction parity or readiness to cut over. `PARALLEL-MODULE-READY=false`. Integrator must review M05/M06 shared SQL interface and owner must approve schema migration/roll-forward-back before deployment.

**Rollback:** revert this test-only PR; isolated synthetic data are disposable.
