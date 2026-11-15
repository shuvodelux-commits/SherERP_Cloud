# M02-P — Finance Transactions Export Completeness (2026-11-15)

**Source pin:** original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 `Config.gs` and `FinanceModule.gs`; `docs/baseline/schema-inventory.json` records exact FINANCE_TRANSACTIONS table and column order.
**Authority:** `AGENTS.md`, ADR-007 (separate Owner/Lender/Borrower accounts), `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`. No production import has been authorized.

## Problem

Existing M02 Party checks (#154/#162/#164/#177) validate all five Party master groups, identity review and readback. `prepareGrossPartyBalances({financeRows})` takes finance transaction rows but does not know their original source export's header list or independently captured source-row count. An accidental truncated `FINANCE_TRANSACTIONS` export, a missing amount column or a zero-row dump misrepresented as a complete financial source could wrongly appear ready for account design. Existing #165 correctly blocks missing/zero active Finance Amount **among supplied transactions**; it cannot detect missing transactions. No existing Finance source-count coverage contract exists.

## Decision

Add a separate pure `validateFinanceTransactionExport({sourceRows,sourceHeaders,declaredRowCount})` in new `src/party/finance-export-coverage.js`.

- Require the exact **20 pinned source column headers, in original order**, including `Finance ID`, `Person ID`, `Transaction Type`, `Amount`, source dates, Payment Method, Bank Account ID/name, Is Deleted and audit fields. Validate every row has its own property for **every** column, whether active or soft-deleted; only `_rowIndex` may appear as an extra non-source property.
- Require an independent, nonnegative **safe-integer** `declaredRowCount`, captured at the source export boundary; compare it with `sourceRows.length` and flag a mismatch even if all supplied rows are otherwise structurally sound. The caller must independently authenticate the captured count; accepting user-supplied count is a compatibility check, **not** data provenance certification. A genuinely empty export may pass only with explicit headers and count `0`.
- Detect missing/duplicate original Finance IDs (within all rows including soft-deleted history), unsafe numeric ID/Person ID values, duplicate/invalid _rowIndex provenance, missing `Person ID` on active rows and invalid active Finance Amount (absent/blank, nonpositive, >2 decimal digits, unsafe minor unit precision). Preserve exact source ID strings, never normalize by name/phone, never map a Finance ID to a Party from a display name. Existing `prepareGrossPartyBalances` remains the authority for nine transaction directions, role matching, signed account buckets and gross totals.
- Permit blank non-ID optional source fields and valid soft-deleted historical rows; no money is treated as posted, and deleted rows do not require a positive amount. Invalid nested or nonfinite cell values still fail. Correct original `Is Deleted` truthy values as boolean true or case-insensitive `TRUE` string.
- Report **only counts and fixed-vocabulary codes**:
`{formatVersion:1,sourceGroup:'FINANCE_TRANSACTIONS',offlineExportComplete,counts:{declaredRows,observedRows,headerIssues,missingFields,unexpectedFields,unsafeValues,missingIds,duplicateIds,missingPersonIds,duplicateSourceRows,invalidActiveAmounts},issues:[{code,count}]}`.
No fields, source IDs, phones, names, Person IDs, amounts, reviewer refs or raw exception strings are copied to the report. Invalid outer shapes must throw a fixed generic `Invalid Finance export` error. Diagnostics must be deterministic and sorted. No mutations.
- This validator does **not** read source Sheets, prove the authenticity of row-count/header metadata, compare changed snapshots, authenticate identity approvals, read or write D1, or authorize migration/cutover. Its `offlineExportComplete` flag is not overall M02 financial readiness. Integrating it into a trusted exporter and mapping full gross accounts remain separate work.

## Scope, ownership, and rollout

Exactly four **new files**: this design, one Superpowers plan, an independent Node test and one pure source module. No modification to existing files, source `FinanceModule.gs`, import planner, gross-balance preflight owned by other PRs, finance posting, D1, auth, RPC, migrations, frontend, Cloudflare. No new dependencies, no desktop work. Rollback by reverting this PR. Use GitHub RED failure before GREEN; verify all exact-head CI. Leave draft unmerged until owner authorizes merging.
