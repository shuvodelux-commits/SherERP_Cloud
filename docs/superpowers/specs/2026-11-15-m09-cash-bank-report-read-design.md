# M09 Cash & Bank Report — source-parity design

**Date:** 2026-11-15. **Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Reports.gs::getCashBankReport`, `Utils.gs::roundMoney_`, `legacy/source/reports.html`. **Status:** internal read-only pure projection, not an activated RPC or real-D1 integration.

## Intent and alternatives

Continue M09 after merged Stock Report PR #183. A live `getCashBankReport` route would currently bypass still-gated session/permissions and M08 reconciliation; rejected. Recomputing M08 source postings or inventing a second Cash/Bank journal is unsafe; rejected. Selected: a read-only adapter from already-authorized original source-shaped Cash Book, Bank Book and Bank Account rows, with executable frozen-GAS source oracle.

## Interface

`projectCashBankReport(snapshot, filters, today)` returns exactly the original `{range,cash,banks,bankTotals,combined}` shape.
- `snapshot.cashRows`: already-active, previously authenticated `activeRows_('CASH_BOOK')` equivalent; do not include soft-deleted rows. Sort by first ten characters of `Date` then `Entry ID` localeCompare, preserving stable order. Cash delta is `Number(Credit)||0 - (Number(Debit)||0)` (source's direction), **not** a second M08 ledger polarity.
- `snapshot.bankRows`: all original `getAllRows_('BANK_BOOK')` rows, including reversal targets and reversal records. Build a **global** set of every truthy `Reversal Of` value. Retain rows whose Status isn't `'Reversed'`, plus `'Reversed'` rows with an ID explicitly referenced by a reversal row. Do not silently remove related reversal pairs or auto-reverse postings.
- `snapshot.bankAccounts`: all `getAllRows_('BANK_ACCOUNTS')` source rows; exclude only exact `Status === 'Inactive'` in report, preserve account order and distinct original account IDs. For each bank, consider only its exact-ID bank book rows, sort source way, and detect any `Type === 'Opening Balance'` **anywhere in its filtered book**. If present, start from 0 instead of stored `Opening Balance`; otherwise start with `roundMoney_(Number(account['Opening Balance'])||0)`.
- `filters` + explicit `today`: reuse M09 canonical `normalizeReportRange`, default current shop-local month and reverse ranges; `Date` may be source-style full timestamps but must have valid canonical `YYYY-MM-DD` first 10 chars. Ranges include dates through `to`. Pre-range Book rows contribute rounded deltas only to opening; post-range rows do not affect reported cash/bank opening or movement.
- Accumulate source `roundMoney_` after **each** cash/bank movement and bank aggregate, including cash by-type `{label,entries,inflow,outflow,net}`, sorted by inflow descending. `cash.closing = roundMoney_(opening+inflow-outflow)`; each bank `{id,name,bankName,opening,inflow,outflow,closing,entries,currentBalance}`, where `currentBalance` is the **stored** source field, not silently reconciled from the Book. Total bank and combined cash+bank opening/closing as source.
- Preserve source fields, key order, native numeric values, fallback `Type || 'Other'`, `Bank Name || ''`, original empty structures, negative and fractional amounts. Do not offset unrelated Party role accounts or treat historical opening rows as new current-session cash movement.

## Trust and safety

Caller must enforce `reports:view`, authenticated session and correct active/raw row provenance. Reject missing arrays, Promise/accessors, inherited/malformed rows, ambiguous duplicate active Bank Account IDs, invalid Date prefixes, and nonfinite money. Duplicate bank ID is an intentional corruption-case fail-closed improvement over frozen GAS's duplicate output. Validation must not run user JavaScript getters. This pure module grants no permissions, queries no D1, registers no RPC, creates no cash/bank writes and introduces no frontend changes.

## Acceptance

Tenish Node source-oracle tests execute original `getCashBankReport`, report range helpers and `roundMoney_` under isolated VM. Exercise opening across periods, same-day ID sort, reversed pairs/orphan reversed book rows, account stored vs book opening, inactive account, current balance, cash by-type and sorting, rounding and invalid input. Test first, **observe real CI RED**, then add minimal pure module, observe GREEN and full existing source/Worker/Workerd-local-D1/browser checks.

## Impact/rollback

Exactly four new files: this spec, `docs/superpowers/plans/2026-11-15-m09-cash-bank-report-read.md`, `tests/m09-cash-bank-report-read.test.mjs`, `src/modules/cash-bank-report-read.js`. No original source copied, no GAS/HTML/print, M08 module, auth, RPC registry, D1 schema, SQL, Worker bindings, postings, migrations or data changes. Revert four files to roll back. Live read/report reconciliation remains gated on reviewed M03/M04/M08 interfaces and authorized real-D1 fixtures.
