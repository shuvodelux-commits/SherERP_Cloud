# Run 1 — M02/M03 49-group operational D1 gap matrix

**Review snapshot:** SherERP_Cloud `main@5290a06abda5a0e42192b8bfbcc2f83e59495647`, 2026-11-17. **Immutable original source:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Status:** SOURCE MAPPING PROPOSAL / REVIEW REQUIRED. No private source export, operational import, cloud D1 write, public RPC or financial posting was executed to create this report.

## Hard evidence boundary

- Frozen Config inventory: **49 source groups** / **49 reviewed logical proposals**, under `docs/baseline/schema-inventory.json` and `scripts/dry-run-source-mapping.mjs`.
- Versioned SQL inventory: **14 SQL migration files**. The existing `scripts/audit-migration-coverage.mjs` classifies **19 groups as partial/schema-only evidence** (4 catalog, 1 diagnostic, 5 audit, 1 Product archive, 5 Party identity, 3 local auth) and **30 groups without qualifying source-group DDL**.
- **Fully imported/reconciled: 0/49.** The 19 partially represented groups do **not** constitute 19 historical source imports. The 30 `unmapped` classifications are those of the checked 14-migration source-group audit; adding a synthetic test/table does not promote these statuses.
- The `proposed logical model` column comes from M02's existing 49-group proposal generator. It is **not** an existing SQL table and cannot authorize creating one. All operational SQL, migrations, and public RPC remain **M03-owned**.
- Every original column is a **source-text preservation obligation**. Original row position is retained; no fictitious unique child-row ID. Name/phone never automatically merges Party identities. Historical opening amounts are not today's cash activity; Customer/Supplier advances, Vendor AP vs AR, Owner equity, Lender AP and Borrower AR must be reconciled independently.

## 49 exact group obligations

| # | Source group | Source columns | Original identity policy | Current DDL evidence | Existing reviewed D1 table (partial only) | Proposed logical model (not deployed) | Semantic reviewer |
|---:|---|---:|---|---|---|---|---|
| 1 | `PRODUCTS` | 19 | record ID + physical row | product-source-archive-only | `legacy_product_snapshots` | `product-master-revision-and-raw-history` | M05 |
| 2 | `BUNDLE_COMPONENTS` | 7 | physical row only | **unmapped** | — | `bundle-component-recipe-version-history` | M05 |
| 3 | `SALE_BUNDLE_COMPONENTS` | 9 | physical row only | **unmapped** | — | `sold-bundle-component-revision-history` | M05 |
| 4 | `SUPPLIERS` | 13 | record ID + physical row | party-identity-only | `party_legacy_links` | `party-supplier-legacy-link-and-gross-accounts` | M08 |
| 5 | `SUPPLIER_LEDGER` | 23 | record ID + physical row | **unmapped** | — | `supplier-payable-advance-ledger-history` | M08 |
| 6 | `STOCK_LOTS` | 13 | record ID + physical row | **unmapped** | — | `purchase-lot-stock-and-fifo-provenance` | M05 |
| 7 | `SALE_ITEM_LOTS` | 10 | physical row only | **unmapped** | — | `invoice-line-original-lot-consumption` | M05 |
| 8 | `STOCK_LOT_COST_CORRECTIONS` | 16 | record ID + physical row | audit-schema-only | `legacy_stock_lot_cost_corrections` | `original-lot-cost-correction-audit` | M07 |
| 9 | `PURCHASES` | 23 | record ID + physical row | **unmapped** | — | `purchase-header-payment-and-original-ids` | M05 |
| 10 | `PURCHASE_ITEMS` | 7 | physical row only | **unmapped** | — | `purchase-line-source-units-and-cost-history` | M05 |
| 11 | `SALES` | 30 | record ID + physical row | **unmapped** | — | `invoice-header-customer-and-original-payment` | M06 |
| 12 | `SALE_PAYMENTS` | 18 | record ID + physical row | **unmapped** | — | `split-tender-and-application-history` | M06 |
| 13 | `SALE_POSTING_JOURNAL` | 11 | record ID + physical row | **unmapped** | — | `original-operation-idempotency-journal` | M06 |
| 14 | `SALES_DRAFTS` | 22 | record ID + physical row | **unmapped** | — | `sales-draft-original-json-and-version-history` | M06 |
| 15 | `SALES_DRAFT_AUDIT` | 11 | record ID + physical row | audit-schema-only | `legacy_sales_draft_audit` | `draft-actor-version-historical-audit` | M06 |
| 16 | `SALE_ITEMS` | 7 | physical row only | **unmapped** | — | `invoice-line-source-unit-and-price-history` | M06 |
| 17 | `CUSTOMERS` | 15 | record ID + physical row | party-identity-only | `party_legacy_links` | `party-customer-legacy-link-and-advance` | M08 |
| 18 | `CUSTOMER_LEDGER` | 24 | record ID + physical row | **unmapped** | — | `customer-receivable-advance-ledger-history` | M08 |
| 19 | `EXPENSES` | 23 | record ID + physical row | **unmapped** | — | `expense-source-payment-and-liability-history` | M08 |
| 20 | `EXPENSE_CATEGORIES` | 5 | record ID + physical row | catalog-schema-only | `expense_categories` | `expense-category-source-identity-history` | M08 |
| 21 | `EXPENSE_PAYEES` | 10 | record ID + physical row | party-identity-only | `party_legacy_links` | `party-payee-identity-without-auto-liability` | M08 |
| 22 | `CASH_BOOK` | 14 | record ID + physical row | **unmapped** | — | `cash-debit-credit-original-entry-history` | M08 |
| 23 | `STOCK_MOVEMENT` | 15 | record ID + physical row | **unmapped** | — | `original-product-stock-movement-audit` | M05 |
| 24 | `SETTINGS` | 2 | record ID + physical row | catalog-schema-only | `settings` | `tenant-settings-exact-key-value-history` | M09 |
| 25 | `SALES_RETURN` | 25 | record ID + physical row | **unmapped** | — | `original-sale-return-operation-and-version` | M07 |
| 26 | `SALES_RETURN_ITEMS` | 12 | physical row only | **unmapped** | — | `original-invoice-line-lot-return-allocations` | M07 |
| 27 | `PURCHASE_RETURN` | 18 | record ID + physical row | **unmapped** | — | `original-purchase-return-document-history` | M07 |
| 28 | `PURCHASE_RETURN_ITEMS` | 8 | physical row only | **unmapped** | — | `original-purchase-lot-return-allocations` | M07 |
| 29 | `CASH_SESSIONS` | 12 | record ID + physical row | **unmapped** | — | `cash-session-open-close-explanation-history` | M08 |
| 30 | `INVOICE_EDIT_LOG` | 12 | record ID + physical row | audit-schema-only | `legacy_invoice_edit_audit` | `original-invoice-edit-before-after-audit` | M07 |
| 31 | `USERS` | 10 | record ID + physical row | auth-local-only | `auth_users` | `staff-original-identity-and-credential-provenance` | M04 |
| 32 | `ROLES` | 6 | record ID + physical row | auth-local-only | `auth_roles` | `staff-original-role-permission-policy-history` | M04 |
| 33 | `SESSIONS` | 6 | record ID + physical row | auth-local-only | `auth_sessions` | `staff-original-session-revocation-history` | M04 |
| 34 | `LOGS` | 3 | physical row only | diagnostic-schema-only | `legacy_error_logs` | `idless-error-log-raw-event-history` | M11 |
| 35 | `DELETE_LOG` | 9 | record ID + physical row | audit-schema-only | `legacy_delete_log` | `original-deletion-actor-and-reason-audit` | M07 |
| 36 | `OPENING_BALANCE_EDIT_LOG` | 12 | record ID + physical row | audit-schema-only | `legacy_opening_balance_edit_audit` | `historical-opening-balance-edits-without-cash` | M08 |
| 37 | `BANK_ACCOUNTS` | 10 | record ID + physical row | **unmapped** | — | `bank-account-original-opening-and-current-history` | M08 |
| 38 | `BANK_BOOK` | 18 | record ID + physical row | **unmapped** | — | `bank-debit-credit-account-entry-history` | M08 |
| 39 | `BANK_TRANSFERS` | 14 | record ID + physical row | **unmapped** | — | `bank-source-destination-transfer-history` | M08 |
| 40 | `FINANCE_TRANSACTIONS` | 20 | record ID + physical row | **unmapped** | — | `owner-lender-borrower-obligation-history` | M08 |
| 41 | `FINANCE_PERSONS` | 9 | record ID + physical row | party-identity-only | `party_legacy_links` | `party-finance-owner-lender-borrower-roles` | M08 |
| 42 | `PRODUCT_CATEGORIES` | 4 | record ID + physical row | catalog-schema-only | `product_categories` | `product-category-source-identity-history` | M05 |
| 43 | `PRODUCT_UNITS` | 4 | record ID + physical row | catalog-schema-only | `product_units` | `product-unit-source-identity-history` | M05 |
| 44 | `VENDORS` | 12 | record ID + physical row | party-identity-only | `party_legacy_links` | `party-vendor-gross-payable-and-receivable` | M08 |
| 45 | `VENDOR_SOURCING` | 16 | record ID + physical row | **unmapped** | — | `supplier-independent-vendor-stock-sourcing` | M05 |
| 46 | `VENDOR_LEDGER` | 21 | record ID + physical row | **unmapped** | — | `vendor-gross-dues-and-receivables-ledger` | M08 |
| 47 | `VENDOR_RETURNS` | 17 | record ID + physical row | **unmapped** | — | `vendor-sourced-item-return-history` | M07 |
| 48 | `VENDOR_ISSUES` | 17 | record ID + physical row | **unmapped** | — | `vendor-consignment-issue-source-history` | M07 |
| 49 | `VENDOR_RETURNS_RECEIVED` | 17 | record ID + physical row | **unmapped** | — | `vendor-return-receipt-source-history` | M07 |

Every row's `sourceRowProvenanceRequired=true`, `operationalFieldMappingApproved=false`, `realSourceReconciled=false`, `sharedD1ImplementationOwner=M03`. The M02 generator also emits the exact `sourceColumns` array for each group. The eight positional-only groups remain distinct from source-master IDs even when their parent IDs repeat.

## Reproduce and fail closed

```bash
node scripts/audit-migration-coverage.mjs --check
node scripts/dry-run-source-mapping.mjs --check
node scripts/dry-run-source-mapping.mjs --json
node --test tests/m02-source-mapping-import.test.mjs
```

These are existing read-only local checks; they do not inspect real private GAS/Sheets exports or operational D1. Their output is the machine-checkable per-group matrix; **do not build another parser or copy of the SQL schema**. Any change from 49/19/30/0 or the pinned source fingerprint requires a reviewed M02 source/migration investigation before refreshing this snapshot.

## Cross-owner decisions required before operational SQL

1. **M02 + accounting reviewer:** Approve exact original source IDs or positions, nullable fields, original date/money/string precision, deleted histories and 7-role gross Party account directions. Preserve unresolved identity candidates in a private review queue; no guessed joins.
2. **M03 only:** Decide actual operational SQL shape, original ID issuance floors, transactional order, constraints, indexes and migrations. Reserve shared `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js` before any edits. `#604` already owns M03 private counter-floor evidence; do not duplicate it.
3. **M04:** Review current session/actor/tenant/role authority in the *same SQL mutation*, last-admin and staff-import gates; protected credential snapshots require separate owner authorization.
4. **M05–M09:** Accept source-specific stock/FIFO, multi-unit/Tiles history, POS/split tender/Cash Session, reversal, gross ledger and report semantics, without authoring a second shared financial writer.
5. **M10:** After separate owner-authorized private source custody and staging access, perform full 49-group import/readback with per-source ID/row checksums, no unexplained gross account or stock differences, tested repeat import and restore.

**Exit condition:** This matrix can be reviewed/approved as a proposed shared contract; it does **not** change `docs/M03_PARALLEL_READINESS.md` from BLOCKED and does **not** count toward M10's 9 or M11's 10 production acceptance gates.
