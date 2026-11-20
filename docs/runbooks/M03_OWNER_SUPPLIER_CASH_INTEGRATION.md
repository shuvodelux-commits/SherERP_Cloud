# M03 Supplier Cash Pay reconciliation — gated first-Shop integration

## Superpowers implementation overview

1. The existing authenticated Owner Worker remains the only HTTP entry point for the first Shop.
2. This slice reuses the already-merged M08 Cash Supplier Pay writer and its immutable D1 posting receipt instead of creating another payment engine.
3. A new private Owner Supplier payment endpoint is closed unless its independent `OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED` flag and all existing Purchase, Sale, and Return gates are true.
4. The same server-side Owner session, immutable Shop identity, and current SQL-time write grant guard every payment.
5. The endpoint requires exact Supplier ID agreement between URL and body, and permits only a current Bangladesh-day Cash payment without Bank or discount.
6. An unchanged operation ID is replay-safe, while a changed intent using that ID is rejected.
7. The already merged M08 migration `0011_owner_supplier_cash_reconciliation.sql` follows existing `0009` and `0010` and replaces the pre-0011 payout Close Day denial with SQL-verified cash reconciliation; this branch does not duplicate that migration.
8. Closing a session computes physical expected cash from counted opening plus sales minus returns minus Supplier Cash payouts, and the SQL trigger independently enforces the same amount and variance.
9. Existing Shops without the 0010 Supplier payment tables retain their older read and Close Day formulas.
10. The Cash Book and Supplier ledger project immutable payment rows alongside the existing Purchase, Sale, and Return movements without netting unrelated Party roles.
11. The original Supplier payment form is preserved, with payment fields disabled until the server attests to the full migrated and authorized operation.
12. Direct private Worker/D1, browser retry, no-double-post, cross-Shop rejection, insufficient drawer and SQL reconciliation tests must pass before a separate production release is even considered.
13. This does not implement general Customer receipt, Bank, Expense, multi-unit/Tiles sale, staff management, automatic multi-Shop provisioning, or the complete ERP finance module.

## Evidence and status

- **RED:** real Workerd/D1 Supplier payment was committed while Cash Session displayed a false `cashOut=0`, and private Owner HTTP returned 404 before its route existed.
- **Parallel integration:** merged PR #828 supplies the SQL-time reconciliation, Cash Session and Cash Book implementation; this branch owns only the missing Supplier ledger, Owner API/UI integration, and end-to-end tests.
- **GREEN acceptance:** same-Shop Supplier Payment ৳100.25 reduces a purchase due of ৳600.00 to ৳499.75 after a ৳150.00 Cash Sale; current drawer ৳49.75; counted Close Day and next opening both ৳49.75.
- **Isolation:** test with distinct Owner sessions and two Shops; foreign sessions cannot read or post another Shop's payment.
- **Transaction:** M08 migration 0010 continues to enforce insufficient cash, SQL-time lease and role, replay identity, immutable legs and atomic rollback.
- **Production deployment:** **NOT AUTHORIZED.** No hosted D1 schema changes or production flag flips are included in this PR. The checked-in Cloudflare login-only release profile remains business-write-disabled.
- **Release prerequisites:** reviewed migrations 0009→0010→0011 applied to a backed-up staging Shop, M03/M04/M08 independent sign-off, full accounting/browser CI, two-Shop provisioning/isolation and owner-approved Cloudflare production procedure. An all-ERP-ready claim is not supported by this limited Cash Supplier Pay integration.

## Related

- MVP P0 integration tracking: issue #690.
- Supplier Details: merged PR #825.
- M08 atomic Supplier Cash posting: merged PR #826.
