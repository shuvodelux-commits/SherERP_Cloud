# M02-P — Exact Finance Soft-Delete Parity in Gross Reconciliation

**Authority:** `AGENTS.md`, M02-P and ADR-007; frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`legacy/source/FinanceModule.gs`). The original derives finance balances from active rows only. No D1 import, live transaction posting or source changes are authorized.

## Root cause
The offline `validateFinanceTransactionExport` treats a source transaction with `'Is Deleted': ' TRUE '` as deleted by trimming and uppercasing the value. The separate offline `prepareGrossPartyBalances` gross preflight tests `string(row['Is Deleted']).toUpperCase()==='TRUE'` without trimming. Therefore the same reviewed Finance export row is classified as deleted for export completeness yet **active** for gross finance checkpoints; deleted amounts may inflate equity or loans, trigger a false duplicate Finance transaction ID, or fail on a soft-deleted row's blank Amount. The original Finance module derives balances only from active records.

## Decision
Use the exact same case/whitespace-tolerant deletion predicate as the existing Finance source export validator, including literal boolean `true`, by trimming the string representation before testing `TRUE`. Do **not** broaden deletion to unknown flags (`1`, `yes`, `FALSE`), rewrite transaction IDs, normalize Person source IDs, auto-net Owner/Lender/Borrower balances or mutate inputs.

## Acceptance
- A source Finance transaction marked `' TRUE '` or tab/newline padded lower-case `true` contributes no gross checkpoint and increments `deletedFinanceRows`.
- A deleted row with a duplicate Finance ID cannot block a valid active transaction.
- A deleted row with an absent Amount is ignored instead of being validated as an active transaction, matching source-export semantics.
- Literal boolean true / bare `TRUE` remain deleted; `FALSE` / padded `false` remain active.
- Gross amounts remain exact signed minor BDT units by *original Person ID* and Owner/Lender/Borrower account; no cash/bank/ledger writes; synthetic inputs remain immutable.

## Scope / safety
Only `src/party/gross-balance-preflight.js` (one guard), `tests/m02-gross-finance-soft-delete-parity.test.mjs`, this spec and Superpowers plan. Independent of open M02 readback, Finance export, checkpoint parity, M03/M04 and stock PRs. No migrations, `src/db/**`, `src/rpc/**`, original GAS/Sheets, Cloudflare config, production D1 or real data. `PARALLEL-MODULE-READY=false`; zero authority to cut over.
