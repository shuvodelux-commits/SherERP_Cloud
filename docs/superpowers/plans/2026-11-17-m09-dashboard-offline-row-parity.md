# M09 — Dashboard Offline Source-ID & Row Parity

**Owner task:** next gate after Dashboard read-model evidence PR #610 (unmerged at intake).  
**Base:** `SherERP_Cloud/main@5290a06abda5a0e42192b8bfbcc2f83e59495647`.  
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Workstream:** M09 (issues #431, #567); coordination #456; M02 candidate queue PR #603 and M03 integrator #22.  
**Owner-only files:** `src/modules/m09-dashboard-offline-row-parity.js`, `tests/m09-dashboard-offline-row-parity.test.mjs` and two new M09 documents.  
**No overlap:** does not touch M02 importer/candidate queue, existing M09 return audits or profit PR #609, M03 D1/RPC, M01 frontend, original Sheets, production assets, or financial writers.

## Twelve-sentence implementation overview

1. M01's Dashboard UI has been merged, while live data and record-level detail remain blocked on M09 reconciliation and M03/M04 authority.
2. PR #610's source-evidence matrix is still under review, so this next task uses an **independent branch from main** and does not import or edit that unmerged code.
3. A dashboard record-level read must retain the frozen source's historical row identity, including soft-deleted physical rows, before it can be trusted.
4. M09 owns a pure source-versus-imported **read-model parity audit**, while M02 owns the importer and identity-review queue and M03 owns shared D1.
5. The audit compares trusted **normalized offline** arrays, not live data or table-presence claims.
6. Its source-row ordinal, unchanged original ID and original-content fingerprint must match the imported record one for one.
7. Missing rows, extra rows, duplicates, changed IDs, changed deletion state and changed fingerprints must each yield a fixed discrepancy code.
8. Sale Return headers and children must retain their exact invoice and return source IDs, and active relations must have valid parents.
9. Historical children of deleted Return headers remain in the physical import but must not be treated as active economic returns.
10. Customer, supplier and finance-person source entries must preserve separate gross account kinds, source account links and **exact canonical integer minor-unit amounts**, never silently netting different roles.
11. The result must contain no private IDs, amounts or raw rows, and `ready:false` must remain fixed regardless of apparent parity.
12. After RED→GREEN and full CI, reviewers may accept this internal contract for future integration; they must not mistake synthetic parity for verified D1 source import, authenticated dashboard permission or cutover readiness.

## Contract

Input: `{sourceGroups:{GROUP:[rows]}, importedGroups:{GROUP:[rows]}}` with fixed groups `SALES`, `SALES_RETURN`, `SALES_RETURN_ITEMS`, `CUSTOMERS`, `CUSTOMER_LEDGER`, `SUPPLIERS`, `SUPPLIER_LEDGER`, `FINANCE_TRANSACTIONS`. Rows are **pre-normalized upstream** to an immutable physical `ordinal`, original `id` (or null only for source groups without stable individual IDs), strict Boolean `deleted` and reviewed lowercase SHA-256 `fingerprint`. Return headers require `invoiceId`; return items require `returnId` and `invoiceId`. Finance/Party ledger rows require `accountKind`, immutable `accountSourceId` and an **already independently validated** `signedMinor` decimal-integer string.

The actual M02 source exporter must prove which source physical row and original ID each normalized row refers to, how deletion markers are interpreted, how fingerprints are computed over source content, and how original monetary precision maps to the same source minor units. This M09 code **does not** generate or cryptographically verify those receipts. A pair of forged matching synthetic arrays could appear equal; therefore no positive parity status authorizes financial data. Names, phones and Party-wide due sums are forbidden identity shortcuts.

## RED / GREEN and acceptance

- RED: test-first tests committed, then the intentionally unimplemented export produced **8/8 expected failing contract tests**.
- GREEN: smallest pure comparator with fixed redacted discrepancy codes and `ready:false` for all outcomes; targeted `node --test tests/m09-dashboard-offline-row-parity.test.mjs` passed **8/8**.
- Full gate: frozen-source `npm run verify:source`, `npm run build:frontend`, `TZ=UTC NODE_OPTIONS='--test-reporter=tap' npm test`, exact-head GitHub required CI, file-owner review and no shared interface conflicts.
- Real-D1 staging source rows, authenticated tenant isolation, SQL source identity mapping, settlement/COGS parity and cross-module account balances remain independent future M02/M03/M04/M08/M09/M10 gates.

**Rollback:** revert the two M09 source/test files and two docs; no D1/production rollback required.
