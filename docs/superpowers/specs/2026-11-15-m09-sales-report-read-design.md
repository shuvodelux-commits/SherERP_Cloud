# M09 Sales Report Read Projection — Source Parity Design

**Date:** 2026-11-15  
**Source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen `legacy/source/Reports.gs::getSalesReport`, `Utils.gs`, `reports.html`.
**Depends:** M05/M06/M07 for invoice/return settlement provenance; M03/M04 for authorized read; M08 for separate ledgers. No live binding is permitted in this slice.

## Decision and alternatives
The original Sales Report computes gross/discount/returns/net/paid/due plus by-day, payment-type and top-customer tables, including two non-obvious rules: returned goods reduce original invoice-date revenue (not refund date) and settled invoice `paid` counts actual customer money, not noncash return credit. Implementing SQL now before upstream M05/M07 customer settlement semantics are approved risks changing accounting. Selected **pure, source-faithful, already-authorized snapshot projection**, tested by running frozen `getSalesReport` as executable oracle. No duplicate settlement engine.

## Contract
`projectSalesReport(snapshot,filters,today)` yields original:
`{range,totals:{invoices,grossSales,discount,returned,netSales,paid,due},byDay,byPaymentType,topCustomers}`.
- `today`: mandatory trusted shop-local date-only, same as merged #125 adapter.
- `filters`: original `{from,to}` semantics, default current month, reverse order, inclusive.
- `snapshot.allSales`: original `getAllRows_('SALES')` equivalent, **all rows including soft-deleted**, preserving exact legacy IDs and original order, already authorized and source-shaped. Filter deletion using source-true flags (boolean true / text `TRUE`), and compare canonical normalized `Date` exactly. Check duplicate selected Invoice IDs **across all rows**, including deleted/historical rows, using original assertion semantics; never silently pick a duplicate.
- `snapshot.salesReturnItems`: already-active original `activeSalesReturnItems_()`, where **both return parent and child are active**. Returns do not need date filtering; they reduce the parent invoice and apply `NetAfterInvoiceDiscount` or legacy invoice discount factor; round each return's per-invoice accumulation exactly as source.
- `snapshot.settlementsByInvoice`: trusted map of **already-authorized, independently derived** customer settlement snapshots: each eligible selected invoice with nonempty `Customer ID` and initial `Due Amount > 0.004` must map to `{paidLater,dueAmount}` (finite numeric values). `paidLater` is actual later Payment money aggregated by original invoice, **never** settlement credits/discounts. `dueAmount` comes from reconciled original customer settlement/return state, not Party net. Reject missing settlement evidence instead of silently pretending the invoice is unpaid. Source does not update non-credit, walk-in or no-due sale amounts from settlement state. A future caller must use customer-ledger M06/M08 reconciled code, not data from browser.
- Preserve rounding per row group and top 15, original stable descending sort, original labels `Walk-in Customer`/`Unknown`, and result key order. Original HTML, UI, printing and `getSalesReport(token,filters)` RPC left untouched.

## Safety
Input snapshot is trusted server-side active/read output, not user-supplied JSON. Require plain own-data values; reject leaked Promise, inherited row/getter, unnormalized date/time, invalid finite amounts in displayed monetary fields. Do not round per-item sale gross before source would. Settlement map must have unambiguous invoice IDs and no prototype collision. No D1, SQL, auth, posting, Party link/net, frontend edits, or financial migrations. Independent read projection cannot prove live financial correctness until M05/M06/M07/M08 SQL reconciliation and real workerd D1 authorized integration pass.

## Test acceptance
Eight or more regression tests execute frozen `getSalesReport`, `reportRange_`, `inRange_`, `sortedByDesc_`, `roundMoney_`, `economicReturnLineAmount_`, native duplicate ID guard inside isolated Node VM. Inject deterministic shop date, native permissions and deterministic **trusted** external settlement fixture. Compare complete response including grouped arrays and order with source oracle, edge cases for returns/discounts/date bounds, duplicate and soft deletion, payment money vs credit, ties/top15, no mutation and invalid input. RED observed on CI before minimal GREEN. No endpoints/D1 reads introduced. Rollback reverts four added files.
