# M09 — Dashboard Source-Row Identity Parity Handoff

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Branch starts from:** `main@5290a06abda5a0e42192b8bfbcc2f83e59495647`.

## Scope: one source-shaped offline checker, not an importer

| Original source group | Row identity/role rule | Specific review |
| --- | --- | --- |
| SALES | Unique original `Invoice ID` across historical physical rows | Active and soft-deleted ID ambiguity blocks invoice drilldown |
| SALES_RETURN | Unique original `Return ID` and exact `Invoice ID` link | Active return cannot point to missing/deleted Sale |
| SALES_RETURN_ITEMS | Physical source ordinal; natural line ID may be unavailable | Original Return ID and Invoice ID retained; deleted header suppresses active economic child |
| CUSTOMERS | Original Customer ID, never match by name/phone | Deletion state and exact physical source row preserved |
| CUSTOMER_LEDGER | Immutable row provenance; Customer AR and advance separate | Never net AR/advance or change source account links |
| SUPPLIERS | Original Supplier ID, never auto-merge with Customer | Deleted master and historical source links retained |
| SUPPLIER_LEDGER | Immutable row provenance; Supplier AP and advance separate | Never net AP/advance |
| FINANCE_TRANSACTIONS | Immutable transaction provenance | Owner equity, lender loan payable and borrower loan receivable never share one account |

**Normalized row contract:** `ordinal` is the positive physical source-row index **within the frozen snapshot**, `id` preserves a documented original legacy key or is `null` where none exists, `deleted` is strict Boolean after a reviewed original deletion-state normalization, `fingerprint` is the 64-character lowercase hex digest of agreed canonical source payload. Return rows include exact `invoiceId`/`returnId`. Finance ledger rows include `accountKind`, `accountSourceId` and canonical signed `signedMinor` string. **This is a proposed read-parity adapter contract**, not proof the current M02 importer already emits it.

**Redacted blocker categories:** `MISSING_SOURCE_GROUP`, `MISSING_IMPORTED_GROUP`, `MISSING_IMPORTED_ROWS`, `EXTRA_IMPORTED_ROWS`, `ROW_COUNT_MISMATCH`, `DUPLICATE_*_ORDINAL`, `AMBIGUOUS_HISTORICAL_*_ID`, `SOURCE_ID_DRIFT`, `DELETION_STATE_DRIFT`, `SOURCE_PAYLOAD_DRIFT`, `RETURN_LINK_DRIFT`, `*_ORPHAN_ACTIVE_RETURN_*`, `*_RETURN_INVOICE_MISMATCH`, `PARTY_ACCOUNT_KIND_DRIFT`, `PARTY_SOURCE_LINK_DRIFT`, `SIGNED_AMOUNT_DRIFT`, and fixed invalid shape codes. No source identifiers, account balances or customer details leave the audit.

**Only two possible outcomes:** `NEEDS_REVIEW` or `ROW_PARITY_ONLY_NOT_AUTHORIZED`. Both contain `ready:false`. The latter means only that the caller-supplied arrays match under this contract. It is **not** real source-signature attestation, SQL/D1 parity, a ledger reconciliation or permission to activate reporting.

**Related independently reviewed evidence:** M09 already has frozen-GAS Sales/Purchase Return child-parent lineage audits and source/row count eligibility; M02 [#603](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/603) owns private importer candidate queues; M09 [#610](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/610) owns the 15-widget summary/detail evidence map; M08 owns real Party gross balance reconciliation; M03 owns shared D1/RPC.

**Further prerequisites:** M02 must provide a verified original-source-row to D1 row receipt with hash rules and deletion semantics, M04 must authenticate the actual shop/actor, M03 must supply a tenant-bound read boundary, M05–M08 must reconcile original ledger and stock semantics, M09 must compare actual source fixtures and record-level reports, and M10/M11 must approve migration/cutover separately. This artifact must never be wired to the public Worker in isolation.
