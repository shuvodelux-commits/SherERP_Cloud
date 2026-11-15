# M02-P — Require dense original Finance header evidence

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` (M02-P), ADR-007 and pinned frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Original `FINANCE_TRANSACTIONS` header order from `docs/baseline/schema-inventory.json`.

## Problem

`validateFinanceTransactionExport` checks exact Finance export headers via `sourceHeaders.length!==columns.length || sourceHeaders.some((field,i)=>field!==columns[i])`. JavaScript `Array.prototype.some()` does not visit a sparse array's missing index, so an original header silently deleted with `delete sourceHeaders[i]` can retain the expected length while passing as `offlineExportComplete:true`. The source-coverage gate must not certify missing header evidence. An exporter can produce sparse arrays in memory even though JSON transport may later serialize holes as null.

## Decision

Iterate the **fixed, dense original header manifest**, comparing each captured `sourceHeaders[i]` against `columns[i]`. No change in accepted fully dense header lists, column order, return shape, or issue codes. Continue to emit exactly one redacted `HEADER_MISMATCH` (count 1) if any expected header index is absent. Do not fill, guess, infer, normalize, alter header arrays, inspect live Sheets, or modify original records.

## Acceptance criteria

- Holes at the first, middle (`Amount`) or last (`Person ID`) of the 20-element captured header array are flagged as `HEADER_MISMATCH`, `offlineExportComplete:false`, even when every source row retains all original fields.
- A dense, exact 20-column export remains accepted.
- Explicit undefined, wrong, swapped, or extra header entries still fail, with existing report format and count semantics.
- Outputs contain fixed codes/counts, never source data, Finance IDs, names, phones or amounts; input rows/headers remain unchanged.
- GitHub test-first RED, minimal GREEN, and exact-head full CI (Node/source, local Workerd/D1, browser and preview safety).

## Scope and safety

Exactly four files: `src/party/finance-export-coverage.js` (one predicate), `tests/m02-finance-export-sparse-headers.test.mjs`, spec and plan. No `src/db/**`, migrations, D1 reads/writes, Worker/RPC, auth, original GAS/Sheets, UI, Cloudflare config, financial posting or cross-role settlement. No production import/cutover; `PARALLEL-MODULE-READY=false`. Revert the PR to roll back.
