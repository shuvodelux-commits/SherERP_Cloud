# M08 Counter Supplier Cash Pay — isolated first-Shop backend slice

**Status:** GitHub test-backed implementation; NOT an activated endpoint, hosted deployment, migration approval or completed Counter.

This is a separate, non-overlapping M08 workstream for #690. It adds an append-only, cash-only Supplier Pay posting module rather than duplicating or changing the frontend/API routing being edited in PR #825 or Super Admin access in #824.

## Business semantics
- Requires a currently authenticated Owner, exact Shop identity, current D1 write grant, open Cash Session, active Supplier with unpaid due from an actual credit Purchase, and strictly positive exact amount in integer paisa.
- Same-day Cash only. Bank/mobile, discounts, backdated transactions, opening lender/loan balances, mixed-role netting and Supplier advance are **not** silently accepted.
- One atomic D1 INSERT triggers a Supplier due decrease, immutable payment credit ledger entry, and physical Cash Out entry. Source credit Purchase debits remain immutable. Operation IDs and canonical tenant+actor+payload hashes prevent duplicate payouts or changed-payload replay.
- Failing the Cash Book insert must roll back the Supplier due change, ledger and receipt together. The SQLite trigger independently checks the current session, identity and granted token hash at write time.

## Critical integration/release gate
The current M03 cash session calculator and older cash book UI only include Cash Sales and Cash Returns. They **do not include this new Supplier Pay Cash Out** yet. Consequently the additive migration includes an explicit trigger preventing a Cash Session with supplier payout from closing until M08/M03 reviews the full Cash Session total/variance and reconciles every source. Do not disable that protection merely to make a Close Day test pass.

This component is not wired into the live Owner Worker nor enabled by `wrangler.shop-user.jsonc`. The integration owner must:
1. Complete the original `paySupplier` UI↔API contract and add route under current Owner authentication, CSRF/origin protection, per-Shop authorization, request validation and audited permissions.
2. Extend **all** session cash-in/cash-out views and Close Day expected/counted/variance guards to include Supplier Pay; reconcile Supplier purchase debit minus payment credit, without counting historical opening balances as cash.
3. Update the supplier ledger screen (PR #825 currently covers purchase-only readbacks) to include this distinct immutable Supplier Payment credit leg in gross role-specific history.
4. Complete first-Shop hosted browser tests, migration review, backups, two-Shop isolation and a controlled release gate before activating postings.

## Independent tests
`tests/integration/m08-owner-supplier-cash-payment-workerd.spec.mjs` runs real isolated local Workerd/D1 migrations and checks:
- credit Purchase 600.00 → cash payout 100.25 → remaining Supplier Due 499.75;
- one receipt, ledger credit and Cash Out; idempotent replay, changed intent rejection;
- invalid or bank payment, overpayment, no Open Day, wrong Owner/Shop and expired grant denial;
- injected Cash Book failure rolls back all money changes; retry succeeds;
- closed-day safety gate refuses a false reconciliation after payout.

No live Cloudflare account operations or D1 writes performed.

## Superpowers review
- RED test committed before SQL/backend implementation; exact-head CI must establish the GREEN phase.
- No changes to frontend builder, Super Admin worker, Owner Worker router, current D1 migrations 0001–0009, original sale/return/purchase code, or existing financial reports.
- This **does not yet make Counter operational**. The production MVP remains NO-GO until real UI routing and the full cash session integration are proven.
