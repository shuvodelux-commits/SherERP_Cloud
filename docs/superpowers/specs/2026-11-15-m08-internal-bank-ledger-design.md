# M08 internal Bank Ledger read projection — design

**Status:** Isolated read-only M08 continuation. Not finance posting, bank transfer execution, a public RPC, a D1 schema, or an M08 release.
**Legacy authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` in frozen `legacy/source/BankBook.gs` and `BankLedger.gs`.
**Prior M08:** merged source inventory #67, cash/bank source characterization #77, pure cash read model #80.
**Dependencies:** M03 shared DB/kernel and M04 authorization, M06 posting interface; these do not yet grant permission for live M08 writes.

## Approaches
- Enable Bank Ledger RPC / D1 financial writes: rejected because shared schema, auth, posting replay/rollback and cutover are not approved.
- Introduce bank journal tables or a new accounting engine: rejected because it risks parallel accounting authority and violates M03 exclusive ownership.
- **Selected:** implement tiny, pure read projections from already-loaded bank account/book rows, with legacy-source oracle tests. No database or API connection; exact inputs are supplied by a future approved repository.

## Behavior and boundaries
- `bankCurrentBalance(accountId, accounts)` mirrors the bank account's stored **Current Balance**, rounded with source `roundMoney_`; missing account yields zero. It must NOT compute current balance by naively summing Bank Book entries because opening figures and soft-deletions differ.
- `totalActiveBankBalance(accounts)` totals only accounts where `Status !== 'Inactive'`, with source rounding. It may include Mobile Banking account types.
- `bankStatement(account, bookRows, {from,to,today})` projects one account's **own** Bank Book rows using selected account identity. Return exact `getBankLedger` data shape (without `ok_` wrapper). Date range: YYYY-MM-DD, invalid `from` → first of `today`'s month; invalid `to` → `today`; swap reversed dates.
- Input `today` and Bank Book `Date` must already be canonical YYYY-MM-DD, normalized for `Asia/Dhaka` by the future repository. This explicit restriction rejects async Promise leaks, bad dates and would-be implicit timezone/clock ambiguity instead of silently mutating or misreporting source data.
- A `Reversed` original with an in-account mirror row whose `Reversal Of` points to it is **retained** and its mirror is counted (true manual reversal audit trail). A `Reversed` original with no such mirror is a voided/deleted entry and **excluded**. No cross-account reversal target may revive a deleted row.
- Chronological order is by `Date`, then `Entry ID`. Running balance is recomputed, never copied from stale stored Bank Book `Balance`. Range entries display newest first after their running balances are determined.
- Exactly one opening baseline: if a surviving Bank Book `Opening Balance` row exists, start at zero; otherwise use `BANK_ACCOUNTS['Opening Balance']`. This avoids both double count and missing balance in pre-backfill data.
- Reconciliation compares all-range-computed bank balance against stored per-account `Current Balance`; `balanced` when absolute drift <0.005. Ledger arithmetic is source-faithful unrounded floating-point; only simple current/combined bank balance helpers use `roundMoney_`.
- Never post a transfer, open a session, authorize a user, read D1, mutate inputs or assume a Party role can authorize banking.

## Acceptance and exclusions
Use source-executed `getBankLedger`, `getBankBalance_`, and `getTotalBankBalance_` as oracles with synthetic row fixtures; hard-code hand-checked expected totals and reversal behavior. Extend existing test-only M08 GAS loader allowlist to include `BankLedger.gs`. Node test RED before module exists; GREEN after minimal implementation; verify GitHub workflows, 84-file source integrity and frontend build.

**File owner:** M08 new `src/modules/m08-bank-read-model.js`, `tests/m08-internal-bank-read.test.mjs`, M08-specific test fixture allowlist and spec/plan. **Do not touch:** `src/db/**`, `src/rpc/**`, `src/index.js`, migrations, UI, Cloudflare config, source `legacy/**`, remote/production DBs. Real Workerd+D1 auth, idempotent writes, concurrency, rollback, ledger gross reconciliation and release gating remain separate unfinished work.
