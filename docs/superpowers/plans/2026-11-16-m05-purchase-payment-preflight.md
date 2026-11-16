# M05 — Source-faithful purchase payment / bank-account preview (2026-11-16)

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Purchase.gs::createPurchase`, `Utils.gs::isBankLikePaymentMethod_` and `Utils.gs::resolveBankAccount_`; source-shaped `src/modules/purchase-preflight.js`. Also read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`.

## Thirteen-sentence module overview

1. The original purchase writer validates the supplier, product lines and paid amount before resolving a payment account.
2. An unpaid purchase has an empty payment method, bank account ID and bank account name even when the request supplies stale payment fields.
3. A paid purchase defaults to Cash when the request omits a payment method.
4. The source defines Bank and Mobile Banking as bank-like methods, while other method labels use the non-bank branch.
5. Bank-like payment requires a selected bank account ID and a matching original BANK_ACCOUNTS record.
6. Frozen `resolveBankAccount_` deliberately permits inactive historical accounts, and the active-only filtering belongs in the UI picker rather than the resolver.
7. The new pure preflight will call existing source-shaped `preparePurchasePreflight` and add only payment method and account resolution fields.
8. Source GAS functions will be executed separately in a VM with synthetic Sheet rows to prove bank-resolution parity rather than guessed semantics.
9. Duplicate bank IDs, unsafe snapshots and accessor objects are migration ambiguity and must reject previewing rather than selecting arbitrary records.
10. Invalid purchase supplier, deleted/bundle product, quantities and payment clamping continue to be enforced by the unchanged purchase helper.
11. The frozen `createPurchase` calls `requireActiveCashSession_` unconditionally before these source checks, so this pure preview must not claim to authorize a cash session or override a later owner-approved setting.
12. Superpowers RED must be a test-first commit that fails with the missing module in real GitHub CI, followed by the smallest GREEN implementation and exact-head regression checks.
13. No changes to D1, source GAS, Party accounts, stock, Supplier due, Cash/Bank ledgers, auth, Worker RPC or production deployment are permitted in this preparatory increment.

## Input/output and changed files

- `preparePurchasePaymentPreflight(payload,{products,suppliers,bankAccounts})` returns original `preparePurchasePreflight` result plus `paymentMethod`, `bankAccountId` and `bankAccountName`.
- A payment that is not bank-like has empty bank identifiers, matching `resolveBankAccount_`, regardless of submitted stale ID.
- Exact `Bank` and `Mobile Banking` strings are source-defined, not an inferred account-type constraint. Historical inactive accounts remain valid matches. Duplicate bank IDs fail closed as an intentional migration safety check over the original first-match resolver.
- New files only: `src/modules/m05-purchase-payment-preflight.js`, `tests/m05-purchase-payment-preflight.test.mjs`, this plan.
- No `src/db/**`, migrations, `src/auth/**`, `src/rpc/**`, `src/index.js`, `legacy/source/**`, original preflight, Cash Session, Party/ledger or frontend edit. No D1 binding added to preview.

## Acceptance, future integration and rollback

- Validate RED with an actual `ERR_MODULE_NOT_FOUND` on GitHub Actions; then GREEN with targeted source-VM parity and full Node/CI.
- Bank-book posting, Cash Book updates, cash-session policy, actor permissions, supplier obligation, bank-balance CAS, operation idempotency, and multi-unit historical snapshots remain for the single M03 transaction owner and coordinated M04/M05/M08/M07 releases.
- Do not infer production readiness or true D1 posting from synthetic pure tests; keep PR draft until all exact-head checks and owner review.
- Revert these three new files to roll back with no business data effects.
