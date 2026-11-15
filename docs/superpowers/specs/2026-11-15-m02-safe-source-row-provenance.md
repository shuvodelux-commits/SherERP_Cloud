# M02-safe — Preserve exact source-row provenance

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Owner:** M02-safe pure Party proposal and existing synthetic local D1 acceptance tests. Follow `AGENTS.md`, ADR-007 and M02-P human-identity approval constraints.

## Defect and behavior
`src/party/party-import-plan.js` validates optional source `_rowIndex` using `Number.isInteger()` and a lower bound of 2. JavaScript's integer representation is not exact above `Number.MAX_SAFE_INTEGER`; two distinct physical row indices can be rounded to one value before provenance validation, and a parsed unsafe value may still look like an integer. A source import proposal **must not** accept an unsafe integer as a physical Sheets row number or silently derive a D1 `legacy_sheet_row` from one. This is a data-provenance safety issue even though genuine Sheets row positions are ordinarily far smaller.

Require **`Number.isSafeInteger(legacySheetRow)` and `legacySheetRow>=2`** for every supplied `_rowIndex`. Retain historical `null` when row metadata is absent; accept genuine safe integer 2 and the maximum safe integer, preserve exact source ID and source-row number without rewriting data. Reject a float, numeric text, negative/one, infinity, and any integer at or beyond 2^53. No row number inference, recasting, guessing or Party automatic merge.

## Boundaries
No changes to `src/db/**`, `migrations/**`, Party account/finance ledger, M04 reviewer authorization, Worker RPC or original source. Actual D1 import is still gated on approval reference persistence, authenticated human reviewer and independent account reconciliation. Tests will use the existing `planPartyImport` contract and `compileSyntheticPartyImport` real Workerd/D1 harness. `PARALLEL-MODULE-READY=false`.
