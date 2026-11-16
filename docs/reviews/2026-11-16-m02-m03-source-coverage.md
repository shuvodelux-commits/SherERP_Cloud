# M02/M03 — Frozen 49-Group Source-to-D1 Coverage Review (2026-11-16)

**Scope:** pinned source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; target baseline `SherERP_Cloud/main@ee86bcf5142bd63b376cc9be6e4cc123841f8ded`. Source authority is `legacy/source/Config.gs` and `docs/baseline/schema-inventory.json`; twelve existing *local-versioned* migrations `0001`–`0012` are considered. The linked tests and script verify the current classifications against SQL table creation and the pinned source.

## Readiness summary

- **49** configured source groups need complete source-to-D1 parity and reconciliation.
- **4** have *catalog DDL only*: SETTINGS, PRODUCT_CATEGORIES, PRODUCT_UNITS and EXPENSE_CATEGORIES.
- **5** have *audit DDL only*: DELETE_LOG, SALES_DRAFT_AUDIT, INVOICE_EDIT_LOG, OPENING_BALANCE_EDIT_LOG and STOCK_LOT_COST_CORRECTIONS, preserving historical IDs, monetary text and source-row provenance under immutable SQL guards. Synthetic import tests are not historical production reconciliation.
- **1** has *diagnostic DDL only*: LOGS, preserving text and source-row provenance without a unique source Log ID. Synthetic offline import proof is not live source reconciliation.
- **5** have *Party identity only*: CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS and EXPENSE_PAYEES. `party_legacy_links` is **not** a money/account/ledger table.
- **3** have *local auth schema only*: USERS, ROLES and SESSIONS. They are **not** a live public RPC or approved source-data import.
- **1** has *isolated source archive DDL only*: frozen canonical PRODUCTS plus a separately identified older multi-unit PRODUCTS/PRODUCT_UNIT_CONVERSIONS snapshot, with original IDs and source-text evidence, not active stock/price writer or live reconciled import.
- **30** have **no source-specific target in versioned candidate migrations** (synthetic Workerd/D1 tests may exist for certain operations; they do not change this release classification).
- **0 of 49** groups have a verified complete source snapshot import and financial/row-by-row reconciliation in this audit. **394** source GAS functions are identified as async-impacted by the separate conservative M03 call graph, not necessarily unported.
- Original GAS and private live Sheets were **not** queried, exported or modified to construct this report. Exact staff source exports and production remote migrations remain separately gated.

## Source group inventory

| Original source group | Source headers | Current versioned evidence | Narrow D1 candidate |
| --- | ---: | --- | --- |
| `PRODUCTS` | 19 | Isolated canonical/older source-profile immutable product snapshots; optional older conversions are not a canonical data group; no live stock/price writer or production-data reconciliation | `legacy_product_snapshots` |
| `BUNDLE_COMPONENTS` | 7 | No source-specific DDL | — |
| `SALE_BUNDLE_COMPONENTS` | 9 | No source-specific DDL | — |
| `SUPPLIERS` | 13 | Party identity only | `party_legacy_links` |
| `SUPPLIER_LEDGER` | 23 | No source-specific DDL | — |
| `STOCK_LOTS` | 13 | No source-specific DDL | — |
| `SALE_ITEM_LOTS` | 10 | No source-specific DDL | — |
| `STOCK_LOT_COST_CORRECTIONS` | 16 | Immutable historical cost-correction audit + synthetic offline import; no current stock/COGS migration or live reconciliation | `legacy_stock_lot_cost_corrections` |
| `PURCHASES` | 23 | No source-specific DDL | — |
| `PURCHASE_ITEMS` | 7 | No source-specific DDL | — |
| `SALES` | 30 | No source-specific DDL | — |
| `SALE_PAYMENTS` | 18 | No source-specific DDL | — |
| `SALE_POSTING_JOURNAL` | 11 | No source-specific DDL | — |
| `SALES_DRAFTS` | 22 | No source-specific DDL | — |
| `SALES_DRAFT_AUDIT` | 11 | Append-only historical audit DDL + isolated synthetic import; no live reconciliation | `legacy_sales_draft_audit` |
| `SALE_ITEMS` | 7 | No source-specific DDL | — |
| `CUSTOMERS` | 15 | Party identity only | `party_legacy_links` |
| `CUSTOMER_LEDGER` | 24 | No source-specific DDL | — |
| `EXPENSES` | 23 | No source-specific DDL | — |
| `EXPENSE_CATEGORIES` | 5 | Catalog DDL and isolated synthetic offline import; no live reconciliation | `expense_categories` |
| `EXPENSE_PAYEES` | 10 | Party identity only | `party_legacy_links` |
| `CASH_BOOK` | 14 | No source-specific DDL | — |
| `STOCK_MOVEMENT` | 15 | No source-specific DDL | — |
| `SETTINGS` | 2 | Catalog DDL only | `settings` |
| `SALES_RETURN` | 25 | No source-specific DDL | — |
| `SALES_RETURN_ITEMS` | 12 | No source-specific DDL | — |
| `PURCHASE_RETURN` | 18 | No source-specific DDL | — |
| `PURCHASE_RETURN_ITEMS` | 8 | No source-specific DDL | — |
| `CASH_SESSIONS` | 12 | No source-specific DDL | — |
| `INVOICE_EDIT_LOG` | 12 | Immutable historical invoice-edit audit + isolated synthetic import; no live reconciliation | `legacy_invoice_edit_audit` |
| `USERS` | 10 | Local auth DDL only | `auth_users` |
| `ROLES` | 6 | Local auth DDL only | `auth_roles` |
| `SESSIONS` | 6 | Local auth DDL only | `auth_sessions` |
| `LOGS` | 3 | Diagnostic STRICT DDL + isolated synthetic import; no live reconciliation | `legacy_error_logs` |
| `DELETE_LOG` | 9 | Append-only historical audit DDL and local synthetic import; no live reconciliation | `legacy_delete_log` |
| `OPENING_BALANCE_EDIT_LOG` | 12 | Immutable historical source audit DDL and synthetic offline import; no live reconciliation | `legacy_opening_balance_edit_audit` |
| `BANK_ACCOUNTS` | 10 | No source-specific DDL | — |
| `BANK_BOOK` | 18 | No source-specific DDL | — |
| `BANK_TRANSFERS` | 14 | No source-specific DDL | — |
| `FINANCE_TRANSACTIONS` | 20 | No source-specific DDL | — |
| `FINANCE_PERSONS` | 9 | Party identity only | `party_legacy_links` |
| `PRODUCT_CATEGORIES` | 4 | Catalog DDL only | `product_categories` |
| `PRODUCT_UNITS` | 4 | Catalog DDL only | `product_units` |
| `VENDORS` | 12 | Party identity only | `party_legacy_links` |
| `VENDOR_SOURCING` | 16 | No source-specific DDL | — |
| `VENDOR_LEDGER` | 21 | No source-specific DDL | — |
| `VENDOR_RETURNS` | 17 | No source-specific DDL | — |
| `VENDOR_ISSUES` | 17 | No source-specific DDL | — |
| `VENDOR_RETURNS_RECEIVED` | 17 | No source-specific DDL | — |

## Next conversion milestones

1. Review every one of the 30 unmapped source groups by dependencies and lock a single schema/posting owner. Use source IDs, original row provenance, gross Party account directions, FIFO and cash-session relationships; do not infer data identity by phone/name.
2. For the next safe source-backed M02/M03 vertical slice, require versioned schema, deterministic offline fixture import with original-ID/readback reconciliation, awaited repo adapter, source-shaped RPC response proof and real isolated Workerd/D1 tests. Do not deploy it automatically.
3. Separately complete protected M04 source/auth/staging policy; maintain the empty production RPC allowlist until specific authorized functions pass real D1 acceptance.
4. Promote a status **only** on reviewed merge evidence of full source data correctness, not because one synthetic SQL table or unit test exists.
5. Following M05–M09 source parity, run M10 full private data rehearsal and M11 approved production cutover/rollback.

**Regenerate read-only result:** `node scripts/audit-migration-coverage.mjs --json`. **Fail-closed frozen check:** `node scripts/audit-migration-coverage.mjs --check`. Updates to source schema/migration DDL require corresponding review and test changes. No remote Cloudflare/D1 access is used.
