# M08/M03 — First-shop read-only financial views

**Scope:** These are two strictly *limited* projections over **existing** first-Shop SQL tables. They are NOT the full Cash Book, Bank Ledger, Expense Ledger, Customer/Party Ledger or production Finance module. No SQL schema changes, imports, transactions or deployment configuration changes.

## Existing authenticated endpoints

- `GET /api/owner/cash-book` (requires the existing `OWNER_MVP_CASH_RETURN_ENABLED` + Owner Google D1 session + exact immutable Shop identity): reads original cash-only Sale and Cash Return entries and summary amounts in integer paisa. Scope is `cash-sale-and-cash-return-only`. Physical opening count is **not** a receipt or cash movement. Nothing is silently inferred about bank payments, manual cash received, expenses, owner investments, historic opening loans or lender/borrower accounts.
- `GET /api/owner/suppliers/SUP-000001/ledger` (requires existing `OWNER_MVP_PURCHASE_ENABLED` + current Owner and Shop): reads source purchase debit, supplier identity, total current due in integer paisa and verifies gross purchase ledger sum. Scope is `purchase-credit-only`. Supplier payments and cross-role settlements are **not** supported by this projection.

Both use exactly the verified `PLATFORM_PILOT_DB` derived from the authenticated Owner session. The results are limited to the newest 50 records, with `hasMore` to prevent silently claiming full history. No user-selected SQL, query strings, extra D1 bindings or privilege tokens. An unavailable/mismatched schema or unreconciled supplier due fails closed with 503. A missing supplier returns 404, and wrong Owner/disabled gate returns 401/404.

## TDD and acceptance

```bash
npm install --no-save --package-lock=false --no-audit --no-fund wrangler@4.161.0
node --test tests/integration/mvp-first-shop-http-lifecycle-workerd.spec.mjs
```

The existing first-Shop HTTP end-to-end Workerd/D1 test now verifies after Product → Purchase → Sale → Return that cash `+15000 - 7500 = 7500` paisa; supplier debit/current due is `60000` paisa; stock is 9 units; repeat financial submissions are idempotent; Shop B has no financial entries. The contract checks missing supplier, wrong session, disabled feature and second-Shop isolation. The existing M03 CI workflow includes this new code path.

**Release boundary:** The currently generated `wrangler.shop-user.jsonc` profile still sets all financial writers to **false**, so neither endpoint is live until the separate M03/M04/M08/M10/M11 hosted release and all required business features are certified. These endpoints are intentionally narrow: the MVP production gate in issue #690 remains open. The next work must preserve and connect original all-cash in/out, bank, expenses and per-role Party ledger accounting rather than treating Sale/Return-only projections as complete.
