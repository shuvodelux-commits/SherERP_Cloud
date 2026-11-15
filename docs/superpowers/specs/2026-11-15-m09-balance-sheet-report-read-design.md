# M09 Balance Sheet Report — source-parity design

**Date:** 2026-11-15. **Authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Reports.gs::getBalanceSheetReport`, `getInventoryValueAtCost_`, `CashBook.gs::getCashBalance_`, `BankAccounts.gs::sanitizeAccountType_`, `FinanceModule.gs::financeBalanceSummary_` and `reports.html`. Continues after merged M09 Profit Report #199.

## Design and scope

This **is not a double-entry balance sheet**. The frozen source describes a limited Business Finance snapshot of Cash, Bank, Mobile Banking and Inventory as assets; Outstanding Loan as the only liability; and Owner Capital as equity. It deliberately **omits** Customer/Supplier dues and retained Profit, so `assets.total` need not equal Liabilities + Equity. Do not silently add unrelated Party account balances or create a general ledger.

A live D1/RPC implementation is not approved pending session+permission gates, M05/M07/M08 data provenance and cross-account reconciliation. The chosen implementation is a small **pure read-only** source-composition adapter:

`projectBalanceSheetReport(snapshot,asOf)` returns `{asOf,assets:{cash,bank,mobileBanking,inventory,total},liabilities:{outstandingLoan,total},equity:{ownerCapital,total}}`.

Caller must supply trusted, already-authorized, source-shaped:
- `snapshot.activeCashRows`: exact `activeRows_('CASH_BOOK')`; sum `Number(Credit)||0 - (Number(Debit)||0)` in source order **without per-row rounding**, then apply `roundMoney_` once. Never add bank book postings or opening twice. Cash session ownership stays M08.
- `snapshot.bankAccounts`: exact `getAllRows_('BANK_ACCOUNTS')`, including Inactive. Exclude only `Status === 'Inactive'`; count `Number(Current Balance)||0` directly. `sanitizeAccountType_` recognizes `'Mobile Banking'`; all other types count as Bank. **No bank balance rounding**; do not recompute Current Balance from Bank Book, which is separately owned by M08. Do not alter existing accounts.
- `snapshot.stockLots`: exact `getAllRows_('STOCK_LOTS')`, **including negative and zero remaining quantities**, and every source row. Sum `Remaining Quantity × Purchase Price` with no rounding or active-product filter. This is intentionally **different from Stock Report** valuation, which includes only positive lot quantities. This is a parity requirement, not a recommended new inventory accounting policy.
- `snapshot.financeSummary`: precomputed independently reconciled M08 Finance role summary, with finite number fields `outstandingLoan`, `ownerCapital` from the authoritative `financeBalanceSummary_` semantics; do not recompute owner/loan balances or aggregate across identities by name/phone. M08 must resolve ambiguous person records before supplying this snapshot.
- `asOf`: explicit trusted valid shop-local date `YYYY-MM-DD`. No implicit `Date` or UTC conversion, and no report date filter (as the original report itself states).

Return original unrounded computed totals (except source cash single final round), native negative numbers and exact keys. Reject missing arrays/Promise/prototype/accessors, nonfinite money/quantities, missing or unreconciled Finance summaries, and duplicate active Bank Account IDs (intentional corruption-only fail-closed difference; source would double-count duplicate records). Never claim this projection proves the *full financial statement* balances or that any production ERP cash/bank data has been migrated.

## Source-oracle RED/GREEN and rollback

- Execute frozen native `getBalanceSheetReport`, `getInventoryValueAtCost_`, `getCashBalance_`, `sanitizeAccountType_` and `roundMoney_` in an isolated Node VM with controlled source row/permissions/memoization stubs. Pass the same **independently reconciled** Finance summary into native `getOutstandingLoan_`/`getOwnerCapital_` stubs. M08 source finance parity is separately tested upstream.
- Test exact full response, negative/zero lot quantities, bank/mobile classification and case sensitivity, status filtering, cash source rounding, foreign balance mismatch (do not force equality), empty books, no date filtering, invalid trust boundary, immutability.
- Test-first RED GitHub Actions before implementation; then minimal GREEN and full source/Worker, local Workerd/D1, browser and print checks. Oracle is a unit source comparison, **not** real authenticated D1 integration for this report.
- Four new files only: this spec, `docs/superpowers/plans/2026-11-15-m09-balance-sheet-report-read.md`, `tests/m09-balance-sheet-report-read.test.mjs`, `src/modules/balance-sheet-report-read.js`. No edits to original GAS, HTML, UI, print, RPC registry, authorization, DB/migrations, M08 journals or Party roles. **Rollback:** revert four isolated files, no data impact.

**Remaining gates:** real D1/Worker authenticated source rows and M08 reconciled Finance summary, source parity with historical cash/finance openings, independent Party balances, reviewed M04 reports:view, and browser-report UI tests.
