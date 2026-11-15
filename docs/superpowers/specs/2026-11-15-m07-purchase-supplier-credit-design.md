# M07-B2 — Purchase Supplier Credit signed-account D1 proof

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseReturn.gs::completePurchaseReturn` and `StockLots.gs::planPurchaseReturnLotReduction_`; approved Party separation ADR-007. Existing test-only M05 purchase and M07-B1 Purchase Cash Return proofs are prerequisites.

## Behavior and boundaries

Original `refundMethod='Supplier Credit'` appends a linked Purchase Return, reduces original purchase's available stock lots and shop stock, creates a Purchase Return stock-out movement, and changes **only original Supplier Current Due**: `newDue = oldDue - totalReturnAmount`. The `SUPPLIER_LEDGER` appends a Credit `Type='Purchase Return Credit'` with source Return ID and **post-credit signed Balance**. A negative Supplier balance is an advance/receivable (supplier owes shop); never clamp or move it into Customer/Owner/Lender accounts. Unlike Cash Purchase Returns, **no cash-backed paid ceiling** applies for Supplier Credit: a fully unpaid original purchase is eligible. No Cash Book, Bank Book, supplier cash settlement or purchase paid amount is modified.

A local proof can reuse synthetic M05 purchase immutable purchase ID, original item/lot/movement, existing M07-B1 `m07_purchase_lot_balances.remaining`, stock and common `m07_purchase_return_moves`. M05's supplier `payable_paisa` models only a test-old posting account and does not support advance reconciliation; create a **disposable test-only signed Supplier oracle** seeded from the actually committed M05 supplier balance. Do not mutate it and do not call it a production ledger. The D1 guard checks matching original supplier source ID, reviewed Party link and signed account Party ID at posting time. Only one standard SKU, one source purchase lot, whole unit, exact-integer-paisa original net unit amount. Source's richer discount rounding, FIFO multi-lot fallback, payments and corrections remain outside this proof.

### Transactional and cross-method identity

New isolated `m07_purchase_credit_returns` and `m07_purchase_credit_ledger` receipts. One guarded D1 INSERT with SQL BEFORE guard for source purchase, item/movement/lot, signed supplier, stock and current Cash Session; AFTER trigger atomically decrements the **shared** lot remaining and shop stock, inserts original-lot outgoing movement, decrements signed Supplier due and appends one source-linked ledger balance. Any second-stage ledger/movement/account failure rolls back **all changes**. A concurrent Cash and Supplier Credit claim for the final unit cannot both post.

The **same original Purchase Return ID / operation ID must be unique across Cash and Supplier Credit**, not merely within one refund method. The new Supplier Credit SQL guard refuses an existing Cash receipt ID/op, and a test-only supplementary BEFORE INSERT guard on the existing Cash return table refuses existing Supplier Credit receipts. No edits to the M07-B1 Cash fixture are required; the supplementary trigger is installed only by this combined test suite. The Supplier Credit receipt lookup distinguishes a prior Cash operation collision as `CONFLICT`; the existing Cash writer may return `DECLINED` on a foreign-method ID.

### Integration limits

No production `completePurchaseReturn`, M04 actor permission, M08 authoritative signed Supplier payable/advance account, source-full FIFO, multi-line M05 stock allocation, original Cash Book or Bank Book, native UI/backdates/return history, edits/deletes or import. This is a **test-only additive proof**, no changes to `src/**`, `migrations/**`, original GAS/HTML/JS, deployed Wrangler, cloud D1 or secrets. `PARALLEL-MODULE-READY=false`.
