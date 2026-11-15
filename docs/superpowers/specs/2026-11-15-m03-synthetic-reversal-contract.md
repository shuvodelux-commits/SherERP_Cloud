# M03 Synthetic Exactly-Once Stock Reversal Acceptance Contract

**Date:** 2026-11-15; **Status:** test-only proof, not a production returns or financial posting implementation.
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `DeleteEngine.gs#deleteSalesInvoice`, `SalesReturn.gs#deleteSalesReturn`, `StockLots.gs#planSalesReturnStockUndo_`.

## Source rules under test
Original sale deletion requires an authorized actor, active Cash Session, no active Sales Return, proven `SALE_ITEM_LOTS` owned-stock consumption, a stable operation journal and exact reversal evidence. Original source excludes vendor-sourced quantities from Current Stock, and blocks duplicate or inconsistent reversal. The proof checks only the **atomicity/identity/one-time direction** of an owned-stock reversal. It does not model all source side effects or claim invoice/stock-lot/accounting parity.

## Selected contract
New `tests/fixtures/m03-reversal-contract.mjs` exports `createSyntheticD1ReversalContract(DB).reverse(input)` where `input` is an exact internal-only object `{tenantId,actorId,reversalId,originalOperationId,originalHash,units,reason}`. The fixture computes a versioned `sales.reverse` fingerprint with merged #51 using tenant and actor and a canonical payload including original source ID/hash, units and reason. Production M04 would supply **trusted** tenant and actor; no HTTP caller may choose these in the synthetic test Worker.

One D1 `batch()` uses a guarded parameterized `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` to reserve a committed reversal **only** against an existing committed original operation with the exact original hash and an owned-stock consumption movement; refuses records with an active return. A unique `(tenant_id,original_operation_id)` constraint prevents a second reversal under a fresh reversal ID; `(tenant_id,reversal_id)` prevents reused ID collision. A SQLite `AFTER INSERT` trigger restores exactly the proven owned quantity to test stock and inserts an inverse movement **in the same SQL statement**; a missing stock row or journal failure raises a SQL abort and rolls back the reversal reservation. This is a narrow synthetic assertion, not an approved generalized trigger architecture for financial modules.

The second statement reads the committed reversal row by scoped reversal ID or original operation ID for replay classification, still in the same batch. Return `REVERSED` for newly committed, `REPLAY` for exact same ID/fingerprint/source/actor, `CONFLICT` when a reversal already exists but differs, `DECLINED` for absent or unproven source, and throw `NEEDS_REVIEW` for malformed/ambiguous batch outcomes. No auto-retry with a new ID.

## Rejected alternatives
- Fetch old stock and update stock from JS: not atomic.
- Insert reversal record then write stock/journal in separate D1 calls: partial commits.
- Restore from current vendor-sourcing quantities or multiply source line count: source-incompatible.
- Unique reversal ID alone: duplicate correction under another ID.
- A synthetic proof as a production schema migration: staging guards presently require two migrations and seven tables; no production table/trigger is authorized.

## Test-only schema and evidence
Use `tests/fixtures/m03-reversal-schema.mjs` constants, installed into in-memory `node:sqlite` and a fake-UUID, nondeployable local Workerd D1. Include `synthetic_original_ops`, `synthetic_owned_movements`, `synthetic_stock`, `synthetic_reversals`, `synthetic_reverse_movements` and test-only triggers. Node tests cover successful restoration, replay/collision, scope isolation, missing/incorrect original, vendor/existing return prohibition, repeated/concurrent second ID, missing stock and forced journal rollback. Workerd tests repeat atomic/concurrency and trigger failure under the real D1 runtime.

No changes to `migrations/**`, deployed Worker, production/staging Wrangler, `src/db/**`, legacy source, `src/rpc/**`, original UI or real money/Party/stock data. Only one import in the existing M03 CI Workerd suite. **PARALLEL-MODULE-READY remains false** pending M02/M03/M04 and shared posting/return parity.
