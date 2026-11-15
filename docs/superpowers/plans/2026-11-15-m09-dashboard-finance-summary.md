# Superpowers TDD — M09 Dashboard signed Finance balance parity

**Source authority:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/FinanceModule.gs` (nine `FINANCE_TRANSACTION_TYPES`, `financeTxnPersonKey_`, `financeSignedBalances_`, `financeBalanceSummary_`) and `Utils.gs::roundMoney_`, consumed by `Dashboard.gs::getDashboardStats`. **Governance:** `AGENTS.md`, ADR-007, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`.

**Ownership:** one M09 source-only, internal read model `src/modules/dashboard-finance-summary-read.js` plus its `tests/m09-dashboard-finance-summary.test.mjs` and this plan. Do not change M03 `src/db`, schema/migrations, M04 roles/session code, M08 future posting kernel, `src/rpc`, Cloudflare bindings or the original GAS/HTML. No remote D1 writes or financial transactions.

## Exact behavior
Project the six **separate** FinanceModule summary amounts from trusted active `FINANCE_TRANSACTIONS` rows: `ownerCapital`, `ownerAdvance`, `outstandingLoan`, `lenderCredit`, `borrowerReceivable`, `borrowerCredit`. The Dashboard consumes only `borrowerReceivable` and `outstandingLoan`; expose all six internally so negative per-person relationship states are never silently lost.
- Map original nine known transaction types to their original `owner/loanPayable/borrowerReceivable` accounts and ± balance effects. Opening types affect their account balance, **but do not turn into today's Cash/Bank movements**.
- Identity grouping matches frozen source precisely: nonempty `Person ID` → `id:` prefix; legacy rows without ID → lowercase, whitespace-normalized `name:` prefix. In the Dashboard path, **no** inferred `personNameToId` mapping. Do not merge same name with an explicitly different ID, or different IDs sharing a name.
- Round signed *per-account, per-person* after each event using frozen `roundMoney_`, then split positive and negative per person into separate named buckets, aggregate across persons, and round buckets at the end. Do not net positive and negative balances of different people; do not net across Owner/Lender/Borrower roles or seven Party identities.
- Ignore unknown legacy transaction type as frozen source does. Coerce primitive amounts via `Number(..)||0`, reject unsupported object/Promise or Infinity rather than silently calculating wrong balances.
- Read-only and trusted-input requirement: `{activeTransactions: [...]}` already filtered with original source active-row semantics by a future M03 trusted repository and separately authorized for `dashboard.view` by M04. This function alone is neither a D1 reader nor an RPC/permission check, and does not assert financial account reconciliations.

## TDD acceptance
1. PLAN commit, then **RED** test-first commit. Tests execute the *actual frozen* transaction-type table, helpers and source `roundMoney_` with a Node VM oracle. Cases: all nine original types and opening semantics; same person holding multiple roles; positive/negative split across persons; per-person rounding; legacy normalized names versus explicitly identified rows; unknown type; invalid rows; immutability; no public RPC.
2. Verify exact GitHub Foundation RED failure: `ERR_MODULE_NOT_FOUND` for the new module.
3. GREEN: minimal pure projector without D1, frontend, source GAS, auth or financial writes. Run exact-head Foundation/source tests and M01 Chromium, M02/M03/M04 real-local-D1/Cloudflare PR-safety *regression* jobs; fix only evidenced failures.
4. Draft PR with RED/GREEN evidence, source/RPC/table impact, final CI and remaining gates. Owner merges after review.

**PARALLEL-MODULE-READY remains false** pending M03 async/data integrity, M04 full authorization, M05–M08 source-equivalent financial posting and separate per-role gross reconciliation. Rollback simply reverts the pure file/test/plan.
