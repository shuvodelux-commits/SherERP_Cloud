# M05 — Composite multi-unit purchase + tender preflight (internal only)

Date: 2026-11-16. Branch: `m05/multi-unit-purchase-payment-composition-20261116`.

## Superpowers implementation overview (12 sentences)

1. This is the next isolated M05 increment after merged PRs #313 and #400; the user requires the source-backed multi-unit purchase feature without losing original single-unit behavior.
2. The **frozen** purchase authority remains `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, especially `Purchase.gs::createPurchase` and `Utils.gs::resolveBankAccount_`.
3. The separate, owner-approved unit conversion algorithm is imported from `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` through already merged `product-unit-conversions.js`.
4. M05 currently has independent internal `prepareMultiUnitPurchasePreflight` and `preparePurchasePaymentPreflight` utilities, with no trusted composition to check unit-derived totals and payment account selection together.
5. This increment will create only an internal **read-only** `prepareMultiUnitPurchasePaymentPreflight` that composes the two existing functions without duplicating or modifying source algorithms.
6. It will require explicit trusted Product, Supplier, Unit Conversion and Bank Account snapshots, including plain data rows with no accessors.
7. It will reject ambiguous duplicate source Product IDs, Supplier IDs or Unit Conversion IDs rather than allowing a Map/first-match to silently choose a price or identity.
8. The **unit normalization goes first**, and the second payment preflight receives a fresh normalized line payload based on the trusted product/price/quantity rather than the browser's claimed cost, factor or name.
9. The output will retain the complete original unit quantity/pricing snapshot alongside source-calculated supplier due, clamped paid amount, payment method, selected bank ID and bank account name.
10. Cash and empty-payment paths preserve their existing Bank/Mobile Banking behavior, and a missing or ambiguous bank account is refused only when the source method needs it.
11. Source-compatible single-unit purchases must produce the same result as the existing Purchase Payment preflight, without loss of line identity or output fields.
12. Tests are committed before the implementation and verified RED in GitHub Actions; GREEN implementation must pass full exact-head CI before owner review, and this is not approval to post a real D1 purchase.

## Acceptance, boundaries and recovery

- New pure API: `prepareMultiUnitPurchasePaymentPreflight(payload, {products,suppliers,conversionRows,bankAccounts})` → `{supplierId,supplierName,lines,subtotal,discount,grandTotal,paidAmount,dueAmount,paymentStatus,paymentMethod,bankAccountId,bankAccountName}`.
- Tests: 145-Pcs mixed-unit + legacy line with Bank payment, Mobile Banking, unpaid, Cash, overpayment clamping and due, identity collisions, browser tampering, invalid/inactive conversion, wrong bank, missing/unsafe snapshots, no input mutation and no RPC/DB writes.
- Exact source parity for no breakdown. Payment and multi-unit previews must agree on their computed totals (under 0.004 BDT binary floating tolerance); any disagreement is a fail-closed review issue, not an auto-correction.
- Source GAS, Google Sheets, `src/db/**`, migrations, M03 atomic posting kernel, M04 auth, RPC registry, Worker, UI, Cloudflare bindings, Party balances, Cash Session, Cash/Bank/stock posting and source data remain unchanged.
- No public permission is introduced. M03/M04 must later acquire **tenant-scoped** source rows and enforce permissions, cash-session policy, server-side quantity conversion, SQL CAS, immutable historical unit prices and atomic exact-once posting.
- Changes: exactly three **new** files — this plan, `tests/m05-multi-unit-purchase-payment.test.mjs`, and `src/modules/m05-multi-unit-purchase-payment.js`.
- Verification: actual GitHub runner RED (missing module) → GREEN Node tests, existing local Workerd/D1, Chromium, source checks, Cloudflare isolated preview; do not claim production purchase integration from synthetic/pure tests.
- Rollback: revert the three new files; no business-data changes.
