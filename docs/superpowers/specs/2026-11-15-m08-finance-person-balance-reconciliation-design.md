# M08 — Finance Person balance reconciliation (read-only)

**2026-11-15. Workstream:** M08 / issue #66. **Frozen source pin:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`legacy/source/FinanceModule.gs:financePersonBalancesForUI_`, `financeBalanceSummary_`, `getAllFinancePersonsForUI_`, `getFinanceBootstrap`). **Depends on:** merged #100 (gross/signed finance balance projection), #111 (chronological ledger), #127 (finance person directory).

## Context and design choice

The original Finance bootstrap presents `personsAll`, `personBalances` keyed by original Finance Person ID and six distinct gross summary buckets. A source person can hold Owner, Lender and Borrower roles without combining their three financial accounts; an inactive person still contributes to historical balances. A migration must not infer a person ID from matching names, telephone numbers, or a Party link.

Options: (1) new D1 Party/finance SQL bridge rejected (M02-P identity reconciliation, M03 SQL ownership and authenticated M04 path not release-approved); (2) independent second balance calculator rejected (duplicate accounting logic); (3) **chosen** a pure read-only composition of existing `projectFinancePersonDirectory` and `projectFinanceRoleBalances`, plus explicit ID reconciliation. This returns a source-shaped snapshot that can be independently checked against **exact pinned GAS functions** under a synthetic test VM.

## Contract

`reconcileFinancePersonBalances(masterRows,activeFinanceRows)` returns `{persons,personBalances,summary}`:
- `persons` comes from `projectFinancePersonDirectory(masterRows)`: one entry per original `Person ID` in source master order, including inactive persons and additive Owner/Lender/Borrower roles. Never duplicate persons for roles.
- `personBalances` keys are the **exact original** master `Person ID` and values `{owner,loanPayable,borrowerReceivable}` with source `roundMoney_` after each transaction. Every master appears even when it has zero activity. Only accepted transaction rows feed balances. Inactive masters retain existing account history. Historical transactions may reference a role that is no longer displayed on the master; source semantics preserve the balance anyway.
- `summary` preserves the **six original gross buckets**, `ownerCapital,ownerAdvance,outstandingLoan,lenderCredit,borrowerReceivable,borrowerCredit`. An Owner negative position does not offset a positive Owner elsewhere; loans and borrower accounts never automatically settle. Original Opening finance entries affect positions but do **not** create today's cash flow.
- Preconditions: loaded synchronous arrays, valid active source transactions as required by #100; original master rows validated by #127. Reject **missing, whitespace-altered, duplicate or orphaned transaction/master IDs** rather than using the original GAS name-alias fallback. A transaction pointing to a missing master—including a matching display name—must fail closed for human M02-P review. `Is Deleted` rows must already be excluded by the caller. No silent dropping of unresolved rows or assigning a new `party_id`.
- Pure operation: no mutation, no remote/local D1 connection, no RPC, no authenticated actor, no role permission decision, no posting/cash/bank, no source-copy transformation.

## Acceptance tests / source oracle

Tests execute pinned `financePersonBalancesForUI_`, `financeBalanceSummary_`, finance role helpers from frozen original `FinanceModule.gs`, plus `Utils.gs:roundMoney_`, under existing test-only VM with synthetic rows. Compare complete `{persons,personBalances,summary}` shapes for the **validated ID-bearing subset**. Assertions cover one/multi-role masters, independent signed balances and six gross buckets, multiple original IDs with same display name, zero-activity persons, inactive persons retaining historic balances, historical role changes, opening noncash semantics, per-row rounding, source master order, immutability and fail-closed missing/orphan/ambiguous/soft-deleted data. M08 test-only fixture is not an authorized D1 adapter.

## File / RPC / table scope and rollback

**Four new files only:** `src/modules/m08-finance-person-balance-reconciliation.js`, `tests/m08-finance-person-balance-reconciliation.test.mjs`, this spec, corresponding TDD plan. **No** `src/db`, migration, Worker entry, RPC registry, auth, original frontend, Cloudflare config, original GAS or database bindings. **RPCs:** zero. **Tables read or written by new module:** zero. **Financial mutations:** zero. **Rollback:** revert four-file PR.

Remaining gates: source-to-D1 Finance Person/transaction import with provenance, reviewed Party linkage, M03/M04 authorization and atomic financial writer, real Workerd/D1 finance reconciliation/replay/concurrency/failure tests and cutover approval. M08-S cross-role settlement stays disabled. Existing unrelated local Workerd checks are not proof of M08 posting readiness.
