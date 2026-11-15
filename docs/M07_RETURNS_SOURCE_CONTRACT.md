# M07 — Native Returns & Corrections Source Contract (preparation only)

**Status:** source contract and no-write preparation. **Not a port, not a deployed feature, not M07 complete.**
**Frozen business source:** [Mohim_ERP@29aa4a5](https://github.com/shuvodelux-commits/Mohim_ERP/tree/29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2). All copied `legacy/source/**` remain byte-identical; this branch does not edit those files.
**Target:** Cloudflare Worker/D1; keep original HTML/JS and native RPC entrypoints. **Shared posting kernel owner:** M03/M06 integration owner, not this M07 preflight lane.

## 1. RPC and source-file inventory

| Pinned source | Native RPC / helper contract | Primary behavior and protected dependencies |
| --- | --- | --- |
| `SalesReturn.gs` | `completeReturn`, `completeReturnBatch`, `getInvoiceForReturn`, `getCustomerInvoicesForReturn`, `getReturnBatchDetail`, `getReturnHistory` | Partial/full sale return, contributing-invoice batch, explicit customer, inherited date/price/stock provenance; authorization `returns:add/view`, Cash Session, backdate policy |
| `SalesReturn.gs` | `getReturnForEdit`, `updateSalesReturn`, `deleteSalesReturn`; helpers `prepareSalesReturnChange_`, `salesReturnCorrectionPriorJournal_` | Native return correction, optimistic Edit Version, stable correction operation ID, audited soft delete, journal replay/Needs Review; no generic correction engine |
| `StockLots.gs` | `planSaleReturnRestoration_`, `applySaleReturnRestorationPlan_`, `planSalesReturnStockUndo_`, `applySalesReturnStockUndo_` | Exact original lot/consumption/restoration lineage including bundles and fallback lot; no unproven physical quantity changes |
| `PurchaseReturn.gs` | `searchPurchasesForReturn`, `getPurchaseForReturn`, `completePurchaseReturn`, history/detail | Supplier-specific purchase return, quantity/discount basis, Cash vs Supplier Credit, `purchase:add/view` and Cash Session |
| `StockLots.gs` | `planPurchaseReturnLotReduction_`, `applyPurchaseReturnLotReduction_` | Prefer source purchase lots; date/Lot-ID FIFO within purchase; refuse depletion of unrelated purchase lots; a legacy fallback needs independently proven origin |
| `DeleteEngine.gs` | `deleteSalesInvoice`, `deletePurchase`, `deleteDayBookEntry` plus native payment/vendor/finance handlers | Original sale/purchase dependency protection, stock/vendor/customer/cash/bank reversal, audit soft delete; Day Book dispatches to owning module |
| `SalesManagement.gs` | `getSaleForUpdate`, `updateSale`, `updateSaleInternal_` | Edit same Invoice ID through existing POS; linked active return blocks edits; original Cash Session must still be open; split-payment journal and settlement proof |
| `returnHistory.html`, `returns.html` | Original return screens and `serverCall` dispatch | Preserve native return-cart and history UI, no redesign; when just one opened invoice contributes positive return quantity, use native single-return flow |

**Original test references:** `Mohim_ERP/tests/multi_invoice_sales_return_regressions.test.js`, `sales_return_correction_{edit,delete,integration,stock,readback,planner}.test.js`, `return_ledger_regressions.test.js`, `pre_correction_native_actions.test.js`, `stock_lot_cost_correction_regressions.test.js`, `docs/qa/sales-return-edit-delete-acceptance.md`, and approved `docs/superpowers/specs/2026-11-11-flexible-batch-sales-return-design.md`.

## 2. Domain invariants to preserve

1. A return creates a separate linked record, **not an edit to the original sale/purchase**. Available quantity = original quantity minus all active earlier returns, guarded again inside authoritative D1 transaction.
2. Multi-invoice sale returns use **2–20 contributing source invoices** and at most **100 lines**, one customer ID, no duplicates, no walk-in batch; split-payment invoices require individual, journal-safe return. Batch ID is grouping metadata; each child has its own Return ID, source invoice, amounts and reversal.
3. Invoice-level discount/line-total cents matter. A requested return price may be lower than, never higher than, the effective original sale price; preserve exact stored `Line Total` when present. Bundle physical restoration uses **the original sale-time recipe** and leaves one financial return line.
4. **Cash refund** is an outgoing cash movement chosen by operator, including a fully unpaid sale; it does **not** automatically change customer due. **Store Credit** changes only that original customer account and ledger, never another Party role or an unrelated supplier/owner/loan account.
5. Purchase Return reduces **the original purchase's available stock lots** (purchase-date then Lot ID FIFO), reduces shop inventory and either registers cash inflow or Supplier Credit. Insufficient source lots fail; do not arbitrarily take stock from another supplier's purchase.
6. Reversing/deleting a return requires original product/lot/stock-movement/consumption evidence; missing or ambiguous lineage goes to **Needs Review**, not a guessed FIFO replacement. An existing returned lot already re-sold cannot be subtracted below zero.
7. Native sale edit/delete is forbidden while active linked returns exist. Native edit is forbidden when source Cash Session closed. Deleting a split-payment sale requires original tender, journal and later-settlement evidence; never infer refund account from an invoice's displayed net.
8. Return correction uses stable operation ID + actor/source/type/payload hash + expected edit version. Same committed operation replays original result, changed intent conflicts, interrupted/uncertain state requires reconciliation, **no auto-retry with a fresh ID**. Full return deletion is audited soft-delete; active selectors, reports and ledger exclude deleted rows.
9. D1 migration must provide **DB-enforced** tenant-scoped optimistic lock/unique source-operation guards and one atomic stock + Cash/Bank + source-linked Party ledger + receipt commit. `D1.batch` without in-transaction preconditions and result checks is insufficient. Concurrent stale reads must yield one financial effect.
10. Party AR/advance, supplier AP/advance, vendor AP/AR, owner equity, loans and payee identity stay distinct. No automatic cross-role settlement. All source legacy links and gross per-account obligations remain traceable through correction.

## 3. Table / row impact (future M07 writers, not changed here)

| Domain | Original Sheets groups / future D1 source-linked records | M07 write direction |
| --- | --- | --- |
| Sale returns | `SALES_RETURN`, `SALES_RETURN_ITEMS`, `SALE_POSTING_JOURNAL`, `INVOICE_EDIT_LOG` | New child returns; versioned edits; immutable reverse receipts; soft-delete with audit |
| Physical inventory | `PRODUCTS`, `STOCK_LOTS`, `STOCK_MOVEMENT`, `SALE_ITEM_LOTS`, `SALE_BUNDLE_COMPONENTS` | Exact linked lot/stock deltas; return-owned fallback provenance; inverse movement once |
| Sales/tender | `SALES`, `SALE_ITEMS`, `SALE_PAYMENTS`, `CASH_BOOK`, `BANK_BOOK` | Source invoice edits/deletes, original tender reversal and refunds, no silent settlement |
| Party obligations | `CUSTOMERS`, `CUSTOMER_LEDGER`, `SUPPLIERS`, `SUPPLIER_LEDGER` + reviewed Party source/account mappings | Source obligation-level, never net Party display total |
| Purchase returns | `PURCHASES`, `PURCHASE_ITEMS`, `PURCHASE_RETURN`, `PURCHASE_RETURN_ITEMS` | Linked return, affected purchase-lot reductions and supplier settlement effects |
| Other dependent rows | `VENDOR_SOURCING`, `VENDOR_LEDGER` and existing deletion/audit record | Native sale delete must unwind vendor-specific evidence; no double sourcing |

No SQL migration, production RPC, Worker, D1 binding or money-changing helper is added in this preflight PR. No raw source bytes are newly copied or mechanically transformed.

## 4. Acceptance / evidence matrix for next M07 PRs

| Scenario | Required proof before calling M07 complete |
| --- | --- |
| Single partial/full return and sequential repeat | Real D1 original lines/quantities/discount/cash or credit/lot/Party account gross parity |
| 2–20 invoice batch, same SKU, one contributing invoice, duplicate, split-payment guard | Real D1 all-child atomic commit, no empty child, cap/identity rejection before writes |
| Return edit quantity/price/method, delete, batch-child edit/delete | Real D1 exact original lot undo; price-only no stock movement; unchanged sibling |
| Source invoice native edit/delete and purchase return | Real D1 dependency guard, source Cash Session gate, purchase lot provenance and vendor/source obligation reversal |
| Replay, changed intent, stale expected version, concurrency | One committed result and stock/cash/bank/ledger effect, conflict or Needs Review otherwise |
| Failure-injected stock, lot, invoice, tender, ledger, audit and receipt mutation | DB rollback of **all** effects, and safe immutable readback; no post-commit JS writes |
| Mixed-owned/vendor/OVERSOLD, bundle historical recipe, legacy fallback, resold returned lot | Exact provenance or fail closed; no fabricated stock/COGS |
| Cash on due invoice, Store Credit with later settlement, split tender | Cash flow and original customer AR remain distinct; attributable settlement guard, source account parity |
| Staff RBAC, tenant isolation, revoked sessions | Trusted actor and current authority asserted inside same atomic posting boundary |
| Deleted-row readbacks, reports, Day Book, Return History, mobile/print | Native UI and source shape parity; soft-deleted rows excluded, audit retained |

## 5. Merge/activation gates

- **M05:** reviewed FIFO/lot posting, bundles and vendor sourcing; original and D1 fixture parity.
- **M06:** frozen atomic sale/receipt/split-payment/cash-session/Party source-account interface; authenticated operation actor and original invoice references.
- **M03/M04/M02-P:** D1 transaction owner, durable auth/permissions/tenant boundary, reviewed legacy links/schema importer.
- **M08:** cash/bank/customer/supplier posting and reconciliation interfaces must be compatible; M07/M08 may overlap only after shared posting contracts freeze.
- Mandatory: real Workerd/D1 concurrency+rollback suites; frontend+RPC original contracts; no-secret CI; versioned migrations with import/reconcile proof and rollback/roll-forward; owner review before merge/activation.

**Current gate:** `PARALLEL-MODULE-READY = false`. Source-behavior Node tests are characterization only and are **not** real D1 or original Apps Script + mapped Sheets clone acceptance.
