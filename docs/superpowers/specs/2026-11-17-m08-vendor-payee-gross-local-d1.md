# M08 source-faithful Vendor gross balances and Expense Payee non-liability (local D1)

**Issue:** #580; parent #66, coordinator #456. **Base:** `main@76cca6a9b107603cc19a727a6907c7602cddd011`. **Dependency:** merged #568 / #509. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Vendors.gs`, `Expense.gs`, `ExpenseSettings.gs`, `Utils.gs`.

## Goal and acceptance

The original Vendor record stores two independent accounts: `Current Due` (our payable) and `Current Receivable` (their debt). Vendor Ledger `Balance Type` chooses which account each row affects; a blank type means Payable. Each active ledger row changes exactly one gross account by Debit minus Credit. Running display balances must follow `Utils.gs:ledgerSortKey_` and `recalculateLedgerBalancesForDisplay_`, not import insertion order. Deleted rows remain auditable but do not change current balances; Inactive Vendors remain readable and cannot be silently merged. Stored master and ledger balance drift is reported, never silently repaired.

`EXPENSE_PAYEES` creates only a Payee identity, and an `EXPENSES.Ledger ID` references it for expense reporting. Expense payment methods and cancellation/deletion must remain visible, with **no inferred payable, cash/bank change, or cross-role settlement**. Never join Vendor and Payee records based on identical literal IDs, names or phones. Duplicate or malformed source group IDs fail closed; requests and queries are tenant-bound. Historical rows keep source legacy-row provenance.

## Boundaries

- New disposable STRICT `m08_*vendor*payee*` D1 fixtures and a read-only adapter, plus M08's existing local Workerd suite and source-VM test loader allowlist.
- No production DDL, `src/db`, `migrations`, `src/rpc`, `src/index.js`, shared posting, Cash Session, live auth, remote D1, public finance API or data import.
- Reuse the frozen source functions in a constrained synthetic VM only for test oracles; do not use VM as security sandbox.
- Local-D1 PASS is **not** production approval. M02 source identity reconciliation, M03 SQL-atomic posting, M04 authorization and M06 payment contracts remain blockers.

**Rollback:** revert only the isolated test fixtures, test cases and these M08 docs.
