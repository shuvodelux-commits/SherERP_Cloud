# M02 Run 12 — exact historical BANK_ACCOUNTS and BANK_BOOK identity/balance proof

**Base:** `main@0deb878e003a6cc643e8a1231a1e7cc1c00c499d`. **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (frozen, unchanged). **Workstream:** M02 issue #24, cross-lane #456. **Prior:** merged #762 (Supplier gross ledger) and #772 (Supplier payment and return book reference). **Scope:** test-only, offline synthetic, nonauthoritative source row audit. This work is NOT a real bank balance proof, operational bank or Supplier posting, production D1 import or source migration authorization.

## 12-sentence implementation overview

1. The merged M02 payment source audit verifies that a Bank Book leg names a bank account ID, but does not prove that this ID belongs to an original Bank Account row.
2. Frozen `BankAccounts.gs` creates `BANK_ACCOUNTS` with stable original `Bank Account ID`, `Opening Balance` and `Current Balance` and leaves the opening unchanged during account name/type edits.
3. Frozen `BankBook.gs` records bank money flowing **out** as Debit and **in** as Credit, updating that account's Current Balance by `Credit-Debit` in posting order.
4. Every audited Bank Book row must retain an exact original Bank Account ID and physical source row position rather than be matched to a bank name or account number.
5. The pure checker will use canonical, lossless source decimal strings and BigInt paisa without converting money through JavaScript floating-point Numbers.
6. `BankLedger.gs` permits an account opening-balance backfill written directly to Bank Book after previous transactions, so its explanatory row must be checked against the master opening but **never counted again** in the posting flow.
7. When no backfill row exists, the master Opening Balance is still the correct initial posting balance and missing backfill alone is not proof of corruption.
8. An original Bank Book row marked Reversed with a matching opposite `Reversal Of` row is an auditable manual reversal, whereas a Reversed entry without a mirror is a source deletion/void requiring separate lineage review.
9. Unpaired reversal mirrors, different-account mirrors, nonopposite signs, duplicate reversal claims and unknown statuses must fail closed instead of fabricating current money.
10. For unambiguous active and paired-reversal history, physical append-order stored running balances and the master Current Balance will be compared exactly without using backdated transaction Date for posting order.
11. The returned report will contain only redacted blocker codes and counts, with unconditional source authenticity, historical account mapping, D1 reconciliation and posting authorization flags set false.
12. After observed test-first RED and smallest GREEN change, the new branch must complete exact-head GitHub CI, independent QA/review and explicit human-owner merge before M03/M08 may consider a separate operational integration.

## Exclusive new files

- `docs/superpowers/plans/2026-11-20-m02-bank-master-source-balance.md` — source-grounded plan and constraints.
- `tests/m02-bank-master-source-balance.test.mjs` — independent synthetic tests, Node test runner.
- `src/party/m02-bank-master-source-balance.js` — pure read-only auditor, **never imported in the Worker**.

No changes to `src/db/**`, migrations, `src/rpc/**`, Worker, `wrangler*.jsonc`, original `legacy/source/**`, source archive or M03/M04/M08 cash/finance modules and no Cloudflare connection. Keep `AGENTS.md`, `PROJECT.md` and shared workflow gates unchanged.

## Source semantics and limitations

The source opening backfill has `Type=Opening Balance`, `Reference=Bank Account ID`, `Balance=Opening Balance` and a Credit for positive opening. Because it is appended *directly*, it may have a greater original physical row index than subsequent monetary postings. It cannot be used as an ordinary credit to calculate current Bank Account money. Source BankLedger shows legacy no-backfill fallback, while BankBook updates current balances in posting order and BankLedger presents date-sorted statements for display. Distinguish reversal mirrors from direct deletion voids; a directly voided Bank Book row remains in the archive but cannot be considered current money without a separate deletion journal/source reconciliation. Unreviewed bank opening precision, historical numeric-only values, insufficient source row scope, erased or unpaired money, bank account ownership across tenants, cash/bank contra entries and transfer header pairings remain blocked for production.

**Required next source gate:** Connect the independently verified private archive row-hash/column mapper to this auditor and merged #772 *only* after owner-controlled lossless original data capture, then reconcile Bank Accounts/Cash Book and multi-role gross liabilities before production posting. Do not publish private source values or remotely write D1.
