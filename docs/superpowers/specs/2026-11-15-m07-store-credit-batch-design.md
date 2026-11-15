# M07-A4 — Atomic Store Credit batch proof (isolated local Workerd/D1)

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `SalesReturn.gs::completeReturnBatch` and `commitPreparedSalesReturn_`. Original UI, backend, scripts and source files remain unchanged.

## Behavior / boundaries

2–20 **contributing** original invoices, one immutable selected Customer ID, unique Invoice IDs, one original source-linked return child per invoice, no walk-ins and no invoice with original `Payment Detail Version='1'`. Source limits to 100 return item lines; this synthetic M06 fixture supports **one owned SKU per invoice**, so it only demonstrates up to **20 lines**, not the 100-line cap. No original bundle, OVERSOLD, M05 real FIFO/consumption, source backdate authorization or native batch ID allocation parity.

**Store Credit** subtracts each child credit from one Customer's **signed** due, permitting advance (negative balance). Every child records the post-child running balance in the original customer ledger's order. All child receipts, movements, lot restorations, credit ledger entries and signed due mutations happen **inside one guarded D1 SQL statement**: failure on the last child undoes the first. Never create Cash Book, Bank Book, supplier ledger or other-Party offset rows. Reuse M07-A2's signed test-only Customer account and child Store Credit SQL trigger; M08 owns production account integration.

The synthetic original Payment Detail Version is explicitly seeded in `m07_batch_source_policy` from M07-A3. Do not infer split tender from payment rows. Review original Customer→Party legacy link at SQL claim time. Also refuse cross-method batch operation/batch IDs already committed by Cash batches or individual return receipts. Distinct child receipts must never conflict with prior Cash/Store Credit; a changed parent intent must be CONFLICT, not a second economic effect. In-flight/unknown D1 errors must return NEEDS_REVIEW, not retry under a new operation ID.

## Implementation choice

New test-only parent table `m07_credit_batches` and `m07_credit_batch_members`, single parent INSERT with SQL BEFORE guard checking every original sale, exact sold lot, selected Party/customer and source Cash Session, followed by AFTER INSERT child `m07_credit_returns` rows. Each child invokes existing M07-A2 trigger to update the signed test account and ledger. Use ordered `json_each` children with explicit row ordering and verify balances on real D1. Immutable parent, M03 canonical intent hashing and replay readback. Add a cross-batch claim guard to existing test-only Cash batch schema so Cash parent cannot reuse credit parent operation/batch ID. No production migration/schema/RPC/preview binding changes.

## Non-goals

No live `completeReturnBatch` RPC, login/auth, source cash/bank book, signed production M08 accounts, M05 verified multi-lot inventory, per-line item prices/discount, returning a split-tender invoice, original walk-in customer creation, edit/delete correction, original 100-line or 20-invoice plus >20-line coverage. `PARALLEL-MODULE-READY=false` until approved M02–M08 gates. Revert this test-only PR to undo; no remote D1 touched.
