# M02-P — Full Party Master Export Coverage (2026-11-15)

**Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 `Config.gs` / `Database.gs`; verified column ordering in `docs/baseline/schema-inventory.json`.
**Dependencies:** approved ADR-007; merged #144 duplicate-ID quarantine; merged #146 Party snapshot drift guard.
**Status:** offline, read-only preflight. Not approval to import, merge Party identities or post ledgers.

## Gap

`validatePartyImportSnapshot` (#146) detects change **between two explicit snapshots**, but two identical incomplete exports can both omit the legacy `Opening Balance`, `Current Due`, `Current Receivable`, `Roles`, source ID/phone columns or the entire column header metadata. Existing synthetic identity fixture deliberately contains sparse rows and cannot prove full legacy export coverage.

## Decision

Add a separate small `validatePartyExportCompleteness({sourceRows,sourceHeaders})` in `src/party/export-column-coverage.js`. Caller passes a source export and its captured sheet headers (including for empty sheets). Compare exactly the pinned column sequence for each of five master groups: `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `FINANCE_PERSONS`, `EXPENSE_PAYEES`. Row-level check all columns are present as own properties. Blank/null values may be valid—**field presence is not an assertion that a financial amount is nonzero**. Flag unexpected row properties (except synthetic provenance `_rowIndex`) and unsupported cell value types or nonfinite numbers. Preserve leading-zero original ID and phone strings: numeric coercion is unsafe and flagged. No money balance validation or settlement; existing `prepareGrossPartyBalances` owns amount/sign reconciliation.

Return only fixed-vocabulary group/code counters (e.g. `HEADER_MISMATCH`, `MISSING_FIELD`, `UNEXPECTED_FIELD`, `UNSAFE_VALUE`, `UNSAFE_ID_OR_PHONE`) and overall counts. Never echo cell values, field names, source IDs, names, phone numbers or finance amounts. Bad collection shapes fail closed with fixed generic errors. Source header order must match frozen source; object key order/array row order do not matter. An empty master group is permitted **only** with its explicit pinned headers.

The true provenance of header metadata must be established by the trusted offline export process; user-controlled `sourceHeaders` alone cannot prove the original Google Sheet was read correctly. `offlineExportComplete=true` means only this **synthetic input** satisfies frozen column coverage, not production import clearance. Real data freshness still needs #146, reviewer authenticity/approvalRef persistence is still blocked, and each role account/ledger still requires gross reconciliation.

## Boundaries and acceptance

Exactly four new files: this spec, a Superpowers plan, a Node test, and a pure module. No changes to shared `src/party/party-import-plan.js`, `src/db/**`, `src/auth/**`, `src/rpc/**`, migrations, real D1, source GAS, frontend, Cloudflare configuration, or existing tests. No local desktop/PC work. No new dependencies. Revert PR for rollback; zero data changes.

TDD: RED missing-module failure on GitHub Actions; GREEN all synthetic original-source header/row/cell, no mutation, no disclosure, zero-row and separate account header tests; verify full exact-head GitHub CI including actual local D1 regression (shared only). No production activation while `PARALLEL-MODULE-READY=false`.
