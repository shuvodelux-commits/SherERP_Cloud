# M02 Run 11 — offline Supplier payment and return source-money provenance

**Ownership:** M02 issue #24; parallel coordination #456; implementation by M03 #22 only after its source permission gate (M05 draft #767).  
**Base:** `main@e81e243b94ff7712ae6c42392ae4fc4c763faf8d`; frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Scope:** offline, untrusted **source-shape** ledger/cash/bank link evidence; **NO** private historical data opened, remote Cloudflare access, D1 import, production auth or money posting.

## 12-sentence implementation overview

1. M02 Run 10 (#762) can reconcile a Supplier's gross Current Due but cannot prove the provenance of the underlying cash or noncash credits.
2. Original `Suppliers.gs::paySupplier` writes `SUPPLIER_LEDGER Type=Payment` with `Credit=Payment Amount+Discount Amount`, while only the actual payment is written to Cash/Bank Book.
3. Cash/Bank Book `Type=Supplier Payment` uses the exact newly generated **Ledger ID** as `Reference`, whereas earlier source records may have used the Supplier ID and therefore need an explicit historical exception review.
4. Original `PurchaseReturn.gs` writes a cash refund as `CASH_BOOK Type=Purchase Return` with `Credit` and an exact Return ID reference, without writing Supplier Ledger credit.
5. A `Refund Method=Supplier Credit` writes `SUPPLIER_LEDGER Type=Purchase Return Credit` with an exact Return ID reference, without any Cash/Bank movement.
6. This run tests those exact source relationships across explicitly supplied `SUPPLIERS`, `PURCHASES`, `PURCHASE_RETURN`, `SUPPLIER_LEDGER`, `CASH_BOOK` and `BANK_BOOK` snapshot arrays.
7. Every stable original ID, Shop-scoped supplied snapshot, exact source group, physical `_rowIndex` and referenced Supplier/Purchase/Return must remain literal and distinct rather than being resolved by names, dates or phone.
8. Source money for this narrow candidate is accepted **only as canonical decimal text** in integer paisa, so numbers or higher-precision legacy artifacts are quarantined rather than silently rounded.
9. Payment cash/bank leg direction, identity, amount, method, bank-account and reversal/deletion status must be checked without treating a settlement discount as a money movement.
10. Duplicate, unbacked, misdirected and unmatched credit/refund flows are fail-closed, while legacy blank payment methods and undocumented historical refs remain review blockers even if heuristically cash-like.
11. The output exposes only fixed blocker codes and counts, and unconditionally denies source authenticity, cash-backed advance allocation, refund entitlement, D1 reconciliation and posting authorization.
12. Following an observed test-first RED and minimal GREEN fix, complete GitHub exact-head CI, independent QA/review and human-approved merge without modifying the shared M03/M04/M08 transaction/kernel paths.

## Exclusive new files

- `docs/superpowers/plans/2026-11-20-m02-supplier-payment-return-backing.md` (this source-anchored plan).
- `src/party/m02-supplier-payment-return-backing.js` (pure offline projection, no SQL/Worker imports).
- `tests/m02-supplier-payment-return-backing.test.mjs` (Node source-linked positive and negative cases).

Do not edit `src/db/**`, shared numbered migrations, production `src/rpc/**`, frontend, Cloudflare Wrangler bindings, original `legacy/source/**`, CI workflows, or any M03/M05/M08-owned files. Verify exact open PR changed-file overlap before review.

## Non-goals, safety and required follow-up

- Passing supplied **synthetic** source shapes is not reading actual Sheets records or proving their authenticity, row counts, deleted-lineage, original ID counter floors or all 49 data groups.
- The source `SupplierSettlement.gs` considers some historical blank Payment Methods cash-like, but the absence of an exact book receipt must never be presented as cash actually paid.
- No allocation of the remaining negative Supplier due into verified **money-backed advance** versus **noncash Supplier credit** is inferred here. Oldest-first settlement, discount permission, cash refund entitlement against net paid, partial reversals and future M08 account classification require separate reviewed source capture.
- All user-visible diagnostics remain aggregate and redacted. The module does not trigger cash/bank/session/party writes and is never imported into a live Worker.
