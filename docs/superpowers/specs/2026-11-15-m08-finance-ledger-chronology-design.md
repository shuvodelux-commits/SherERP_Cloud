# M08 Finance Ledger chronological read projection — design

**Status:** Internal read-only M08 preparation; not an authorized D1 or public RPC. **Legacy source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/FinanceModule.gs:getFinanceLedger` and `financeSignedBalances_` / `financeBalanceSummary_`. **Prior merged M08:** #80, #81, #96, #100.

## Why and alternatives

A Finance Ledger must display chronological running balances correctly for all Owner equity, Lender loan payable and Borrower loan receivable, even when the user filters by one date, type or person. The original computes running accounts **before filtering**, sorts by business Date then Finance ID, shows **newest first**, and computes six **gross** summary buckets before display filters. Future Worker code may accidentally start balances from the first filtered row or mix roles.

- New SQL ledger / RPC / posting: rejected. M02-P/M03/M04/M06 shared posting/auth gates are not approved for this migration lane.
- Single per-Party net balance: rejected under ADR-007; Owner, Lender and Borrower accounts must not offset.
- **Chosen:** pure internal `projectFinanceLedgerRows(activeFinanceRows, filters={})`, returning `{rows,summary}` from already-active, source-shaped, canonical-date rows. Source-independent tests run exact original `getFinanceLedger` in a test-only VM as oracle.

## Contract

Accept `Date` exactly `YYYY-MM-DD` as already normalized in Asia/Dhaka by a future authorized repository, `Finance ID`, `Transaction Type`, `Person ID`, `Person`, `Amount`, and the optional source presentation fields. Original nine types retain their exact label, account, balanceEffect, cashDirection and opening flags. For each person **source Person ID**, calculate three separate account positions (owner, loanPayable, borrowerReceivable) with source `roundMoney_` **after each transaction** sorted ascending by source Date then Finance ID. For each shaped row, retain original `financeId,date,transactionType,transactionTypeLabel,account,accountLabel,personKey,personId,person,paymentMethod,bankAccountId,bankAccountName,amount,debit,credit,balance,referenceNo,notes,createdBy,createdAt,isBackdated,backdatedDays,backdatedReason`. Debit and Credit columns here are **cash movement directions** for the finance ledger, not the same as owner balanceEffect. Opening types have debit=0, credit=0.

Optional filters `{dateFrom,dateTo,transactionType,personId,query}` perform source string filtering after all running balances. Date bounds do not swap automatically: original `getFinanceLedger` does not swap them. Query matches finance ID, person name, reference, notes, transaction key and label, account label case-insensitively. Return displayed rows newest first. Summary stays whole-history (or whole-history selected original Person ID) independent of date/type/query and is calculated via the already-merged `projectFinanceRoleBalances` from sorted rows, never from displayed rows. Caller passes already-active rows, so fail closed on deleted/pending/malformed rows. **No name-to-ID alias fallback:** source allowed it for some historical rows but this Worker read projection intentionally requires explicit original Person ID and quarantines missing IDs for reviewed M02 mapping. Nothing authorizes a person using their role alone.

## Acceptance and exclusions

10 source-executed or independent regression tests cover interleaved same-person roles, backdating, same-day Finance ID tie, date filters not zeroing prior balance, type/search/person filtering after source running, source no-filter projection, opening noncash rows, six gross summary, no data mutation, fail-closed missing/ambiguous IDs and Promise/canonical-date mistakes. No new dependency and no shared M03/M04/M06 schema or auth touches.

**Files owned:** `src/modules/m08-finance-ledger-rows.js`, `tests/m08-finance-ledger-chronology.test.mjs`, this spec and the implementation plan. Test runner already allows pinned `FinanceModule.gs`. **File/RPC/table impact:** four new files; zero RPCs, zero table reads/writes, no original source copying, no migration. Real D1 gross per-account reconciliation, approved import links, authorized RPC, atomic financial posting/idempotency/reversal and future M08-S remain blocked. Rollback is the four-file PR revert.
