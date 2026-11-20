# M08 Counter Supplier Cash Pay — isolated first-Shop backend slice

**Status:** GitHub test-backed implementation plus separate reviewed-proposal 0011 cash reconciliation; NOT a live endpoint, hosted deployment, remote migration approval or completed Counter.

This is a separate, non-overlapping M08 workstream for #690. It adds an append-only, cash-only Supplier Pay posting module rather than duplicating or changing the frontend/API routing being edited in PR #825 or Super Admin access in #824.

## Business semantics
- Requires a currently authenticated Owner, exact Shop identity, current D1 write grant, open Cash Session, active Supplier with unpaid due from an actual credit Purchase, and strictly positive exact amount in integer paisa.
- Checks the physical Cash Session drawer **at SQL insert time**: prior counted cash carried into the session, plus real Cash Sales, less real Cash Returns and earlier Supplier cash payouts must cover the new cash payout. A first-day shop with zero physical cash cannot pay a Supplier out of thin air. A rejected insufficient-cash operation has no receipts or financial side effects.
- Same-day Cash only. Bank/mobile, discounts, backdated transactions, opening lender/loan balances, mixed-role netting and Supplier advance are **not** silently accepted.
- One atomic D1 INSERT triggers a Supplier due decrease, immutable payment credit ledger entry, and physical Cash Out entry. Source credit Purchase debits remain immutable. Operation IDs and canonical tenant+actor+payload hashes prevent duplicate payouts or changed-payload replay.
- Failing the Cash Book insert must roll back the Supplier due change, ledger and receipt together. The SQLite trigger independently checks the current session, identity and granted token hash at write time.

## Follow-up reconciliation: additive migration 0011 (PR #828)

The 0010 safeguard remains deliberately active until a Shop D1 also receives the separately reviewed **`0011_owner_supplier_cash_reconciliation.sql`** migration. Migration 0011 replaces the Cash Session Close guard with a formula that includes real Supplier Pay Cash Out, and protects Sales Returns posted *after* a supplier payout against a negative cash drawer. The Supplier payment trigger from 0010 already protects the reverse posting order.

Exact cash-session arithmetic is now:

`Expected Cash = previous physical count carried into session + same-session cash sales − same-session cash returns − same-session supplier cash payments`

`Cash In` and `Cash Out` report current-session movements. Physical counts carried over between sessions are **not Cash In**, and historical opening customer balances, loans, lenders, and other opening Party balances do not enter the drawer calculation. Count variance is recorded as an audit fact without manufacturing a balancing Cash Book transaction.

The private Owner Cash Session read and write functions now select the Supplier Pay cash table only when it exists (legacy D1 compatibility), and the read-only Cash Book shows an immutable Supplier Payment entry and exact current-plus-historical Cash Out. The test enforces actual POS Sale cash availability, opposite refund/payout ordering, counted Close Day, idempotent retry, next-session carry and forged SQL-close rejection. This migration is **NOT automatically applied to live D1**.

### Critical remaining ERP release gates

This component is **not yet wired into the live Counter screen** or enabled by `wrangler.shop-user.jsonc`. Before doing so:
1. Connect the original `paySupplier` RPC to an authenticated Owner API with CSRF/origin protection, server-verified Shop context, audited permissions and the new D1 posting module; do not expose unauthenticated public RPC.
2. Extend the visible supplier detail ledger (currently strict `purchase-credit-only` from PR #825) to a reviewed *combined* purchase debit and cash-payment credit history with correct running balances. Do not change the existing scope claim without updating the frontend contract.
3. Keep the Cash Session scope **narrow** until all additional real cash operations (Customer Receive, Expenses, Bank Cash movements, etc.) are implemented and included in these formulas. If any new cash writer is introduced, it must extend every authority/projection/Close Day guard together, not silently bypass the 0011 guard.
4. Complete hosted browser tests with two shops, schema backups, forward-only migration review and explicit production release approval before enabling posting.

## Independent tests
`tests/integration/m08-owner-supplier-cash-payment-workerd.spec.mjs` runs real isolated local Workerd/D1 migrations and checks:
- credit Purchase 600.00 → real Cash Sale receipt 150.00 → cash payout 100.25 → remaining Supplier Due 499.75 and physical drawer 49.75;
- zero physical drawer blocks Supplier Pay until actual cash arrives;
- one receipt, ledger credit and Cash Out; idempotent replay, changed intent rejection;
- invalid or bank payment, overpayment, no Open Day, wrong Owner/Shop and expired grant denial;
- injected Cash Book failure rolls back all money changes; retry succeeds;
- closed-day safety gate refuses a false reconciliation after payout.

No live Cloudflare account operations or D1 writes performed.

## Superpowers review
- RED test committed before SQL/backend implementation; exact-head CI must establish the GREEN phase.
- No changes to frontend builder, Super Admin worker, Owner Worker router, current D1 migrations 0001–0009, original sale/return/purchase code, or existing financial reports.
- This **does not yet make Counter operational**. The production MVP remains NO-GO until real UI routing and the full cash session integration are proven.
