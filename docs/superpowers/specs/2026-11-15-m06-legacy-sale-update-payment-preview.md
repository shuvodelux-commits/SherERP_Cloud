# M06 — Legacy single-payment Sales Update preview

**Authority:** pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `SalesManagement.gs::updateSaleInternal_` payment branch; `Utils.gs::resolveBankAccount_`, `isBankLikePaymentMethod_`, `isValidNonNegativeNumber_`, `roundMoney_`; already merged M06 `planSaleUpdateLineTotals`. Apply repository `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 and M03 readiness gate.

## Why

PR #258 safely previews modern Payment Detail Version=1 split-tender updates; original pre-version-1 invoices use a **different** Cash/Due/Partial contract. Conflating them would change historical invoice data, omit the correct Bank/Mobile account, or incorrectly reject an Inactive historical bank account.

## Scope, input and output

Add internal pure `planLegacySaleUpdatePaymentPreview(snapshot,{canEditSales})` returning `{invoiceId,subtotal,lines,discount,grandTotal,paidAmount,dueAmount,paymentType,paymentStatus,paymentMethod,bankAccountId,bankAccountName}`.

Trusted `snapshot`: exact original `invoiceId`, unique original `sale` header with `'Payment Detail Version'` absent/empty, `oldItems`, `newItems` (source Product-ID keyed POS rows), `discount`, `paymentType`, `paidAmount`, `paymentMethod`, `bankAccountId`, `bankAccounts`. M03 must provide server-filtered tenant-scoped, source-shaped records; M04 server-derived `sales:edit`. No web client may set `canEditSales`.

Reuse `planSaleUpdateLineTotals` for exact historic auto-priced totals and sequential subtotal. Then execute frozen legacy source semantics:
- Discount is nonnegative finite value or 0, and `grandTotal=Math.max(0,subtotal-discount)` **without prematurely rounding**.
- `paymentType='Cash'`: Paid=Grand, Due=0. `'Due'`: Paid=0, Due=Grand. `'Partial'`: Paid is a valid nonnegative finite supplied value **strictly** >0 and <Grand; Due=Grand-Paid; invalid Partial rejects (rather than silently zeroing). Other payment types reject.
- Payment Status is Paid/Partial/Due from positive Paid and Due (native source rule); Payment Method is chosen `paymentMethod||'Cash'` only when Paid>0, otherwise blank.
- The frozen `resolveBankAccount_` accepts Bank or Mobile Banking payment methods with a selected existing original bank account and returns its source ID and Name. Crucially it deliberately **does not exclude Inactive accounts** when resaving a historical invoice; drop-down filtering is separate. Non-bank methods ignore any provided bank ID. The source also does not require matching the Bank Account Type in this legacy path; enforce no policy that would change source parity.
- Reject missing/duplicate/orphan header, malformed or nonplain source records, accessors, unsupported split format (Payment Detail Version 1), bogus discount, invalid quantity/price, overflow, duplicate proposed Product IDs. No implicit Party/Customer creation or name/phone matching.

**Exclusions:** This helper is *only* a source-equivalent numeric/payment preview, not original Update Mode eligibility, Cash Session validation, return guard, evidence of Cash/Bank ledger or Customer settlement, or a license to post. Actual edit must use the existing `projectSaleForUpdate` gate and fresh M03/M04/M05/M07/M08 DB transaction protections. No original UI/GAS, D1, worker, RPC, stock/ledger, Party or financial writes.

## Verification

Pin source blob hashes. A test-only Node VM executes original `saleUpdateLineTotal_`, `roundMoney_`, `isValidNonNegativeNumber_`, `isBankLikePaymentMethod_`, `resolveBankAccount_` **and the exact payment branch text of `updateSaleInternal_`**; compare outputs with new pure module across Cash/Due/Partial, Bank/Mobile/Inactivate, fractional unchanged lines, zero/over-discount and invalid cases. Test authorization, precise ID, source immutability/accessor denial. Superpowers GitHub RED→GREEN, Foundation, Chromium, Workerd/D1, Cloudflare PR checks. Draft PR until all checks and owner review.
