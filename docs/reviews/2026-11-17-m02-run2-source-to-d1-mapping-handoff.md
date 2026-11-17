# M02 Run 2 — Complete source-group mapping proposals (49/49)

**Source pin:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Base:** `SherERP_Cloud/main@7c81dca09f975fbda37586eb50c2763c7f8506df`.
**Ownership:** M02 issue #24 mapping/design only. M03 issue #22 owns all versioned migrations, shared `src/db`, RPC, transaction and atomic SQL. M10 issue #312 owns authorized source-to-actual-D1 rehearsal. Central board: #456.
**Runtime contract:** `node scripts/dry-run-source-mapping.mjs --check` or `--json`.

## Verified mapping starting point

The current **versioned-D1 DDL audit** has 49 original sheet groups, 19 with partial schema-only evidence and **30 without source-specific table coverage**. These are **not 19 completed imports**. All 49 still require independently authorized source-data reconciliation (currently 0/49 fully reconciled). A safe M02 plan can propose target semantics, source identity and reconciliation obligations, but it may **not** create or approve the shared M03 database schema.

## Module handoff by source domain

| Proposal domain | Groups | Downstream source contract reviewer | Critical acceptance before operational D1 integration |
|---|---|---|---|
| Stock and products | PRODUCTS, PRODUCT_CATEGORIES, PRODUCT_UNITS, BUNDLE_COMPONENTS, SALE_BUNDLE_COMPONENTS, STOCK_LOTS, SALE_ITEM_LOTS, PURCHASES, PURCHASE_ITEMS, STOCK_MOVEMENT, VENDOR_SOURCING | M05 and M03 integrator | Preserve original product/lot/PO identities, units, FIFO date+Lot ID ordering, sales lot-consumption provenance and vendor sourcing; no new stock writer |
| Sales and split tender | SALES, SALE_ITEMS, SALE_PAYMENTS, SALE_POSTING_JOURNAL, SALES_DRAFTS, SALES_DRAFT_AUDIT | M06 and M03 integrator | Original invoice/draft identity, split applied/tender/change amounts, posting operation IDs, exactly-once receipts and original edit provenance |
| Returns and corrections | SALES_RETURN, SALES_RETURN_ITEMS, PURCHASE_RETURN, PURCHASE_RETURN_ITEMS, INVOICE_EDIT_LOG, DELETE_LOG, STOCK_LOT_COST_CORRECTIONS, VENDOR_RETURNS, VENDOR_ISSUES, VENDOR_RETURNS_RECEIVED | M07 and M03 integrator | Original sale/purchase/lot effects and once-only reversal, deleted data history and prior cost snapshots; never add a second correction engine |
| Unified Party source identities | CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS, EXPENSE_PAYEES | M08, M02 Party reviewers and M03 integrator | Retain five independent legacy ID namespaces; human-reviewed identity linking only, no name/phone joins; Payee is not automatic debt |
| Gross cash, bank and finance | CUSTOMER_LEDGER, SUPPLIER_LEDGER, VENDOR_LEDGER, CASH_BOOK, CASH_SESSIONS, BANK_ACCOUNTS, BANK_BOOK, BANK_TRANSFERS, FINANCE_TRANSACTIONS, EXPENSES, EXPENSE_CATEGORIES, OPENING_BALANCE_EDIT_LOG | M08 and M03 integrator | Independent gross account directions, Vendor payable vs receivable, owner vs lender vs borrower, historical openings distinct from current cash/bank, source net differences investigated |
| Private staff authentication | USERS, ROLES, SESSIONS | M04 and M03 integrator | Staff role ≠ Party role; password/salt/token material privately imported with revocation and authority proof, never exposed on public preview |
| Settings | SETTINGS | M09 and M03 integrator | Original key/value source text, secret redaction and Settings actor permission; source values never published |
| Diagnostics | LOGS | M11 and M03 integrator | Id-less source row provenance and timestamp/context/message retention with redaction, no invented Log ID |

The source-group lists above together cover **49 groups exactly once**. Each group has an exact `sourceColumns` obligation (all original fields preserved as text), explicit `sourceRowProvenanceRequired:true` and source identity rules consistent with #493. Repeated parent IDs in line-item and lot-consumption rows **must not** be assigned a fictitious unique source master ID; use original sheet physical position and original parent fields.

## Required handoff and validation gates

1. **M02:** Review all 49 source groups with `--json`. The output includes current partial D1 evidence and blank/not-approved operational mapping status for every source group. Never reclassify a group as imported just because an unrelated local synthetic D1 test passes.
2. **M03:** Decide *actual* shared source archive/operational table shape, unique constraints, frozen IDs, originals of deleted rows, historical monetary text and deterministic import ordering. Update SQL through **one M03-owned** integration PR after design review. Do not treat the proposed archive as an existing table.
3. **M04/M05/M06/M07/M08/M09:** Review business-specific semantics while M03 retains the SQL writer. Preserve separate gross Party account buckets and original FIFO/returns/cash-session invariants. A green unit test for an isolated module does not activate public writes.
4. **M10:** With explicitly authorized source snapshots and a separately produced D1 candidate, validate independent counts, exact source row and field fingerprints, gross financial account totals, FIFO quantities, replays, deleted histories, backup/restore and rollback. Current M02 mapping report does not supply real D1 evidence.
5. **Reviewers/merge:** Require full exact-head GitHub CI and protected-path approvals; branch `m02/*` does not alter shared migrations, Worker bindings or `src/rpc`. No remote data writes, production deployment, or private source exports.

## Known accounting obligations (not computed by this mapping review)

- Customer receivable and advance are not supplier payable and advance.
- Vendor **Current Due** and **Current Receivable** are independent gross amounts, never netted.
- Owner equity/drawings, lender loan payable and borrower loan receivable are separate, even under one Finance Person.
- Payee identity alone never creates a liability.
- Original opening balances and opening-balance edit history do not create current Cash Session turnover.
- Product stock, purchase lots and sales-lot allocation use original purchased lot ordering, not only product aggregate stock.
- Multi-unit/Tiles Box/Pcs/Sqft and immutable revision history must be reviewed with M05 prior to operational stock writer approval.
- Auth role, session identity and revocation stay with M04, independent of Party roles.
- Source `Is Deleted`, reversal audit data, backdated original date/time, numeric strings, Bengali and phone text must remain source-faithful.

**This is the M02 proposal stage of Run 2, not production import acceptance.** Source data remains untouched. **0/49** source groups are yet certified as fully reconciled to live data.
