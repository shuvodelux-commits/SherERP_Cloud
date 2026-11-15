# M02-P Finance Source Export: Safe Physical Row Provenance

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, owner-approved ADR-007 and immutable original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Issue

The offline-only `validateFinanceTransactionExport` checks the optional source `_rowIndex` using `Number.isInteger(value)`. JavaScript can report `true` for positions above `Number.MAX_SAFE_INTEGER`, even though different original positions cannot then be represented precisely. The Finance export can therefore claim `offlineExportComplete:true` for a row whose physical legacy sheet-row provenance cannot be trusted. The Party importer already requires `Number.isSafeInteger` for its row-index provenance.

## Decision

Require `Number.isSafeInteger` and `_rowIndex >= 2` for every supplied Finance export source row position. Preserve the existing `INVALID_SOURCE_ROW` fixed-vocabulary diagnostic, source count and original Finance ID rules, row omission semantics and no-write behavior. Do not coerce floats/strings or round positions; no new source ID, no auto-merge and no D1 changes.

## Acceptance

- Unsafe integer positions `Number.MAX_SAFE_INTEGER + 1` and `1e20` must block export completeness with `INVALID_SOURCE_ROW`.
- Exact valid positions `2` and `Number.MAX_SAFE_INTEGER` remain accepted as numeric provenance within this isolated validator.
- Existing fractional/zero/non-numeric and duplicate row-position checks unchanged.
- Audit output contains fixed issue codes/counts only, no Finance IDs, source values or sensitive metadata; input is unmodified.
- Full GitHub RED → GREEN, frozen-source audit and affected Workerd/D1/browser/preview CI.

## Safety/scope

One existing `src/party/finance-export-coverage.js` numeric guard, new focused Node test, this spec and plan. No `src/db/**`, SQL/migrations, Worker RPC/auth, source GAS/Sheets, UI, production/staging D1, money or stock writes. `PARALLEL-MODULE-READY=false`. The export validator is not authority to migrate financial records.
