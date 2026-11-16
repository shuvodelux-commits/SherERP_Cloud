# M02 — Frozen INVOICE_EDIT_LOG immutable D1 source import

**Target base:** `SherERP_Cloud/main@0f30f6f9a0cb947c8df21aa22234bd12e73465e0`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Config.gs` and `SalesReturn.gs`). Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md` and ADR-007.

## 13-sentence overview
1. The next bounded M02 increment is `INVOICE_EDIT_LOG`, an original historical editing-audit sheet.
2. Frozen Config.gs lists 12 fields: Log ID, Invoice ID, Edit Date, Reason, Before Grand Total, After Grand Total, Return ID, Before Return Amount, After Return Amount, Before Return Items JSON, After Return Items JSON and Edited By.
3. SalesReturn.gs writes return-edit entries to this log, with some unrelated grand-total fields left blank.
4. The source assigns the `IEL` prefix to log IDs, but imported IDs must never be recreated, renumbered or synthesized.
5. The candidate SQLite STRICT schema will retain every original source field as text, an internal storage key and an independent physical row-position provenance key.
6. Real source numeric amounts may be safely serialized to decimal text, while original amount strings and JSON snapshot bytes must remain unchanged.
7. Native Date objects may become ISO strings, but existing source date strings must remain byte-for-byte intact.
8. Blank optional fields must be preserved, while blank or duplicate original Log IDs, malformed values and unexpected source fields fail closed.
9. Immutable SQL UPDATE and DELETE guards will prevent rewriting historical audit entries.
10. We will introduce no foreign keys to live invoices, returns, Party identities, user accounts or financial ledgers because historical references have not been reconciled.
11. A bounded one-shot offline importer will preflight the whole source, then atomically execute a fresh-target sentinel and parameterized inserts inside one D1 batch.
12. Tests will verify original amounts and JSON, a later-row SQL failure rollback, single-winner concurrency, replay denial, immutable history, exact postcommit readback and no public import endpoint.
13. This change will not access production Sheets, deploy remote D1 migrations, modify the original ERP, correct historic invoices, post financial transactions or assert live source-data reconciliation.

## Scope and tests
- New numbered `0009` migration, source-locked pure mapper, local-only one-shot importer, Node tests, actual Workerd/D1 tests and PR-only fixture.
- Update current baseline migration-count, schema-verifier and frozen 49-group coverage tests with a third audit-schema-only group, leaving complete live-data reconciliation at zero.
- RED commit first: tests and fixture with intentionally absent DDL/mapper/importer; record exact failing GitHub CI. GREEN next: minimal implementation and all affected GitHub CI.
- Source GAS and actual business Sheets remain read-only; no Worker/RPC/preview deployment or changes to POS/finance/Party posting.
