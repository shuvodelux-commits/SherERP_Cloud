# M09 dashboard source-reconciliation matrix — pre-activation only

**Source:** frozen `legacy/source/Dashboard.gs`, `Reports.gs`, `Config.gs` and original ledger/return modules; exact pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**UI:** [M01 Dashboard Step 3](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/601) merged on `main`; issue #567 remains open for genuine filtered records and chart points.  
**Code:** `src/modules/m09-dashboard-read-model-evidence.js`. This matrix is deliberately an **internal evidence receipt checklist**, not a complete source-to-D1 row reconciliation or authorization.

## The 15 source-backed widget contracts

| Widget ID | Minimum source groups for summary | Extra detail sources / specific hazards |
| --- | --- | --- |
| `today-sales` | SALES, SALES_RETURN, SALES_RETURN_ITEMS, SETTINGS | SALE_ITEMS for records; unique invoice IDs, active return lineage and net-economic pricing |
| `receivable` | CUSTOMERS, CUSTOMER_LEDGER, SETTINGS | Customer AR gross obligations, settlements and reviewed Party source links |
| `payable` | SUPPLIERS, SUPPLIER_LEDGER, SETTINGS | Supplier AP gross obligations; no auto-offset with the same Party's customer AR |
| `cash` | CASH_BOOK, SETTINGS | Original cash movements/balance, independent of bank movement and session opening balances |
| `gross-profit` | SALES, SALE_ITEMS, SALES_RETURN, SALES_RETURN_ITEMS, SALE_ITEM_LOTS, SALE_BUNDLE_COMPONENTS, VENDOR_SOURCING, EXPENSES, CUSTOMER_LEDGER, SUPPLIER_LEDGER, SETTINGS | FIFO cost layers, discounts, bundle sourcing, returns and Party settlement attribution |
| `low-stock` | PRODUCTS, STOCK_LOTS | Reviewed actual lots/stock cache and source product IDs; no fictional low-only filter |
| `today-collection` | SALES, CUSTOMER_LEDGER, SETTINGS | Paid sale amounts plus customer cash receipts, never count settlement discount as cash |
| `today-expense` | EXPENSES, SETTINGS | Correct approved vs cancelled records and shop-local posting date |
| `today-purchase` | PURCHASES, SETTINGS | PURCHASE_ITEMS for records; source IDs and purchase lineages |
| `borrower-receivable` | FINANCE_TRANSACTIONS, FINANCE_PERSONS, SETTINGS | Independent borrower AR, not owner equity/supplier due |
| `outstanding-loan` | FINANCE_TRANSACTIONS, FINANCE_PERSONS, SETTINGS | Independent lender AP/owner capital, no cross-role netting |
| `sales-trend` | SALES, SALES_RETURN, SALES_RETURN_ITEMS, SETTINGS | SALE_ITEMS for invoice/point drilldowns, reviewed 14-day source-date ranges |
| `cashflow` | CASH_BOOK, BANK_BOOK, BANK_ACCOUNTS, SETTINGS | Per-account inflow/outflow and transfer deduplication |
| `recent-sales` | SALES, SETTINGS | SALE_ITEMS, SALES_RETURN, SALES_RETURN_ITEMS, CUSTOMER_LEDGER for source invoice details |
| `dues` | CUSTOMERS, CUSTOMER_LEDGER, SETTINGS | Source customer ledger lines and exact debt/advance role |

**Receipt prerequisites:** each required original source group must have an internally reviewed import receipt with `sourceRows` and `importedRows` equal, plus `sourceIdsReviewed`, `provenanceReviewed` and `deletionStateReviewed` true. Missing group, untrusted receipt and count mismatch have **different** blocker categories. Zero can be trusted only if the imported source itself was explicitly reviewed as zero rows.

**Shared prerequisites:** source identity and snapshot, shop-local date semantics, authenticated tenant boundaries. Per-widget reconciliation additionally requires relevant return, stock lot, Cash/Bank, gross Party/finance, settlement and FIFO cost review flags. All detail requests require independent record-ID coverage and filtered-source/date review. Manifest flags do not substitute for signed/verified source row evidence and must be produced by reviewed M02/M03/M04/M05–M08 integration steps.

## Fail-closed diagnostics

`evaluateM09DashboardReadModelEvidence(manifest)` returns one entry per widget:

- `summary` and `detail` each disclose only `missingGroups`, `unreviewedGroups`, `countMismatchGroups`, `missingReviews` and fixed statuses.
- `BLOCKED` means the supplied internal receipt is incomplete/invalid.
- `AWAITING_AUTHENTICATED_D1_GATE` means *only* that the synthetic summary receipt is internally consistent; it is not verified shop D1 access or report/record accuracy.
- `ready:false` is fixed for all entries and the response root. No source rows, invoices, Party identities, customer names, SQL, tokens, financial balances or fake chart points are returned.

**Next actual reconciliation work:** collect immutable source-ID-to-D1 imported row proofs and per-group discrepancies, verify source deleted/cancelled states, check unique invoice/item lineage, lot and returns attribution, finance/cash/party gross balances and actor/tenant permission in the same trusted read boundary, and only then propose an authorized read. M09 reports gate #431 and M03 integrator #22 must own/review all shared interfaces. The public Worker remains fail-closed.
