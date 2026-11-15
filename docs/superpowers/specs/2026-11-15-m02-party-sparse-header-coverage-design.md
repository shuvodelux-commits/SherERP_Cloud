# M02-P — Dense original Party master header coverage

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, ADR-007, pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and `docs/baseline/schema-inventory.json`.

## Problem

The offline-only `validatePartyExportCompleteness` checks header lists with `supplied.some((name,index)=>name!==expected[index])`. `Array.prototype.some()` skips a sparse array hole. After a source-export header position is deleted using `delete headers[index]`, the array length remains unchanged and `some` does not validate that index. The five master groups—CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS, EXPENSE_PAYEES—can therefore erroneously receive `schemaMatches:true` and `offlineExportComplete:true` despite missing trusted header provenance. PR #246 fixed this exact class for FINANCE_TRANSACTIONS; this PR closes the analogous Party-master gap.

## Decision and acceptance

Iterate the frozen, dense original `expected` header list, comparing `supplied[index]` to every `name`. Keep existing length validation, source group/column names, issue shape, counters, immutable input and fail-closed policy. Add direct regression cases for sparse hole at the beginning, at a financial/role/payee field, and at the last column across all five source groups. A fully dense exact export remains valid; explicit undefined, swaps, extra columns and deleted row fields must remain invalid. Reports include only known source-group names and fixed diagnostic codes/counts, no Party IDs, names, phone numbers, account balances, or approval references. The change does not infer missing fields from rows, coerce IDs, authorize identity merges, or net role accounts.

## Scope and safety

Four files: `src/party/export-column-coverage.js` (one predicate), new `tests/m02-party-export-sparse-headers.test.mjs`, this spec and plan. Original GAS/Sheets and UI remain unchanged. No DB migrations, D1, Worker RPC, permissions, finance/stock/cash postings, source records, or production import/cutover. `PARALLEL-MODULE-READY=false`.

## Verification

GitHub Superpowers test-first RED on the unchanged source, minimal GREEN one-predicate fix, exact-head Foundation/source audit/browser/real local Workerd D1/Cloudflare secret-free preview safety. Merge gated on review and full CI evidence.
