# M02-P — Preserve Exact Finance Transaction IDs in Gross-Account Preflight

**Authority:** `AGENTS.md`, M02-P in `docs/WORKSTREAMS.md`, ADR-007, pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`legacy/source/FinanceModule.gs`).

## Root cause
The offline `prepareGrossPartyBalances` preflight groups active `FINANCE_TRANSACTIONS` by `String(row['Finance ID']).trim()` while the source sheet and original finance writer preserve a literal `Finance ID`. Two original IDs such as `F-001` and ` F-001 ` are different source records, but trimming causes a false `FINANCE_ID_DUPLICATE` blocker and suppresses both transactions' gross-account checkpoints. The original Finance transaction source sorts with `String(a['Finance ID']).localeCompare(String(b['Finance ID']))` without altering IDs.

## Design
Retain the literal finance transaction ID as the collision key, like the already-exact `Person ID` source key and Party legacy links. Use `.trim()` only to detect entirely blank identifiers. Never normalize, merge, repair or reassign Finance IDs. Exact repeated IDs remain a blocking `FINANCE_ID_DUPLICATE`. Unknown Person IDs, finance role validations, amounts, soft deletes, and independent Owner/Lender/Borrower gross buckets stay unchanged.

## Acceptance
- Two active transactions with distinct literal `Finance ID` strings, differing only by surrounding whitespace, are each included in gross positions; no false duplicate blocker.
- Exact repeated IDs still block both records; all-whitespace IDs still emit `FINANCE_ID_REQUIRED` and no account impact.
- The same literal ID remains an exact-match duplicate even across different valid original Finance Person IDs.
- Tests verify totals, source/finance input immutability, zero cash/bank/ledger writes and no names/phones leaked to diagnostics.
- GitHub CI RED first, minimal GREEN, source verification, local real Workerd/D1 and browser/preview safety regressions.

## Scope/safety
One expression in `src/party/gross-balance-preflight.js`, one new Node test, this design and a plan. No `src/db/**`, migrations, D1 imports, `src/rpc/**`, original UI/GAS/Sheets, Cloudflare config, cross-role settlement or cash/ledger posting. This is an offline financial **reconciliation preflight**, not live finance implementation. `PARALLEL-MODULE-READY=false`.
