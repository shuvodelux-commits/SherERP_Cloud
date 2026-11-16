# M02-P — Finance Transactions deletion-flag source provenance

**Authority:** `AGENTS.md`, M02-P of `docs/WORKSTREAMS.md`, ADR-007 and the immutable original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Frozen `legacy/source/Config.gs` documents `Is Deleted` as `'TRUE'` for deleted records and blank otherwise. Existing source-coverage regression fixtures also accept explicit `FALSE`; the offline validator accepts string case/whitespace and literal booleans for legacy exports.

## Problem

`validateFinanceTransactionExport` currently uses generic `cell(value)` for `FINANCE_TRANSACTIONS['Is Deleted']`; any finite number such as `1`, `0`, or a non-standard string such as `'YES'` is judged safe, despite not being recognized as deleted by `softDeleted` or `prepareGrossPartyBalances`. Such a row can incorrectly pass `offlineExportComplete:true` and be treated as an active historical finance transaction when it should be reviewed as ambiguous source state. The gross preflight must never guess that an unknown marker means a live finance obligation.

## Decision

Require the Finance export deletion flag to be one of: `null` (legacy blank), literal boolean `true` or `false`, or an exact string empty/`TRUE`/`FALSE` ignoring surrounding whitespace and ASCII case. Reject all other values as existing `UNSAFE_VALUE` issue, including numeric 0/1, `'1'`, `'YES'`, and `'DELETED'`. The existing 20 fixed columns, header order, IDs, amounts, source positions, declared counts, other field types, and issue-report schema remain unchanged.

The validator must not coerce or modify flags, infer deleted or active status from numeric aliases, rewrite original Finance transactions, create identity links or decide accounting balances. Upstream offline rehearsal already blocks gross preflight when `offlineExportComplete` is false.

## Acceptance

- Every unrecognized `Is Deleted` flag yields `UNSAFE_VALUE` count 1, `offlineExportComplete:false` even if all other 20 fields and declared counts are complete.
- Two independently invalid flags yield count 2. No original values, IDs, names or amounts leave the fixed-code diagnostic.
- Blank, null, literal booleans, trimmed case-insensitive TRUE/FALSE strings pass; deleted blank-amount rows remain permitted.
- Existing active positive-money checks, exact raw Finance IDs/Person IDs, source-row provenance, and input immutability are unchanged.
- Real GitHub test-first RED before source edit, minimal GREEN, then full exact-head Foundation, frozen source/UI, local D1/Workerd, M01 browser, M04/M09 and Cloudflare PR-safety checks.

## Scope / restrictions

Only `src/party/finance-export-coverage.js` (one small private predicate and one conditional), `tests/m02-finance-deletion-flag-provenance.test.mjs`, this spec and plan. No original GAS/Sheets/front-end modifications, schema/migration/RPC/auth, remote D1, cash/bank/ledger/finance posting, auto-linking Parties, account netting, manual settlement, or production import/cutover. `PARALLEL-MODULE-READY=false`; revert the PR to roll back.
