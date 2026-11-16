# M06 — Replay of posted sale after Bank/Mobile account deactivation

**Source and scope.** SherERP AGENTS.md, docs/WORKSTREAMS.md M06, frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, the existing `normalizeSalePayments_` contract, and M06 local synthetic D1 sale-posting proof. This is **not** production activation.

## User outcome and risk
A cashier submitted an authorized Bank or Mobile Banking sale and may retry the *same stable operation ID* if the first receipt response was lost. A staff member can subsequently deactivate that payment account. The current synthetic `post()` runs active-account normalization before it sees the existing operation and rejects the retry, despite persisted invoice + tender + Bank Book evidence already proving the payment was committed. This can provoke duplicate user action and gives an inaccurate historical receipt.

**Required behavior:** Replaying the original tenant+actor+operation+intent, after account deactivation, returns `REPLAY` with the original invoice ID and zero new writes. A different operation using the now-inactive account must be refused, with unchanged stock/ledger. A tampered payload or another actor using an existing operation ID stays `CONFLICT`; it cannot claim authority from the historical exception. Existing exact posted-receipt readback must still pass, including draft consumption guards.

## Candidate approaches
- **Chosen:** narrowly allow an inactive bank/money account only for normalization of a *previously stored, same-tenant, same-actor operation ID*, then use existing canonical payload hash, exact receipt verification and D1 atomic SQL active-account guard. This makes receipt acknowledgement historical and leaves new-sale authority unchanged.
- Reject every retry against inactive accounts: simplest but breaks idempotent acknowledgement on legitimate account lifecycle changes.
- Disable active-account validation for every post: unsafe because new sales could bypass preflight, even if SQL remains protective.

## Boundaries and safety
Only the isolated `tests/fixtures/m06-sale-posting-contract.mjs` and Workerd/D1 integration regression change, plus spec/plan. No `src/` production code, migrations, RPC, source GAS/HTML, Cloudflare bindings, Party ledger or change to cash session policy. No copying live customer data. Prior-operation lookup is read-only and cannot authorize a new write: `SQL_POST` still enforces bank account active status, signed customer, stock and cash-session SQL guards. An unknown or wrong-actor operation must not receive the historical allowance.

## Acceptance
1. Real local Workerd/D1 RED test posts Bank+Mobile tender, deactivates both payment accounts, then same-operation retries fail under the current behavior (expected defect).
2. GREEN replays both original invoices with zero financial/stock mutation; changed actor and changed intent return `CONFLICT`.
3. Fresh operations using inactive accounts still reject without side effects.
4. All M06 and sibling M07/finance regression checks, foundation/source and browser CI are reviewed at exact PR head. No assertion of production readiness.
