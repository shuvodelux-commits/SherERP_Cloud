# M06 — Draft Invoice Read-Only Preview Projection

**Date:** 2026-11-15
**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/DraftSales.gs` lines 154–168 and 325–358, `SalePayments.gs`, `Customer.gs` and `Invoice.gs`.
**Status:** Read-only internal projection only. Production draft writers, sale posting, auth/RPC and D1 financial schemas remain unapproved.

## Decision and approaches

The existing M06 #64 port of pure split-payment helpers and #71 real local D1 synthetic posting proof do not yet cover draft invoice previews. Existing `getSalesDraftPreview` reads a draft row after authorization, parses saved JSON, uses trusted bank account rows to normalize split payments, and returns an invoice-shaped payload. A draft preview never reserves stock or posts money.

Approaches:
1. Activate original GAS `getSalesDraftPreview` as a Worker RPC — **rejected**: it needs M04 auth, M03 D1 adapter and trust boundary.
2. Introduce a new independent draft writer and SQL schema — **rejected**: overlaps M03 ownership and duplicates transaction logic.
3. **Selected:** migrate a tiny, Worker-compatible *read-only* draft parser/preview projection, using explicit, already-authorized row/account/shop inputs; pin its output and errors against the frozen original in test-only VM fixtures. No datastore or API access.

## Contract

`parseSaleDraftRow(row)` returns the legacy `parseSalesDraftRow_` shape for a canonical date string row with `Draft Date` already normalized as ISO `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss`. JSON parse failure is mapped to original empty item list or empty payment object; no write or repair. The caller must enforce authorization before fetching the row. `Customer ID`, names, relation, version, original items/payment and actor snapshots are preserved; no identity lookup or auto-merge.

`projectSaleDraftInvoice(row, {paymentAccounts, shop})` returns the original `buildSalesDraftPreviewPayload_` invoice shape. `paymentAccounts` are trusted already-read BANK_ACCOUNTS-compatible objects; `shop` is the trusted prebuilt invoice shop payload. The projection invokes existing port `normalizeSalePayments_` with exact integer-paisa semantics when `Payment JSON` contains a `payments` property, never by guessing from amounts.

- Split payments display original bank/mobile account, applied amounts, tender/change and `paymentDetailVersion: '1'`. Inactive/mismatched bank accounts fail closed.
- Legacy single-tender drafts retain `paymentDetailVersion: ''`, empty child list and payment method. Provisional amount received clamps between zero and grand total.
- Both kinds display `paymentType: 'Draft'` and `paymentStatus: 'Draft'`, not `Paid` even if provisionally tendered.
- Draft number is used as preview invoice ID; actual invoice allocation must be separate in a future atomic posting service.
- Draft itself is not a financial record; no stock, session, Cash/Bank or customer AR mutation.
- This internal helper is not an RPC, authorization engine or renderer; it never reads a database or settings.

## Bounds and risks

Current source `safeDateOnly_` uses GAS date conversion when given Date objects. This pure projection consumes **canonical D1 date text only**; the future repository boundary must normalize dates in Asia/Dhaka before calling, and date/timezone parity needs separate end-to-end integration tests. The projection intentionally does not authorize or validate persistence. No new customer link may be inferred from name or phone. No current user/session fields are accepted.

**Files:** new `src/modules/sale-draft-preview.js`, `tests/m06-draft-preview.test.mjs`, `tests/fixtures/m06-draft-preview-oracle.mjs`, this spec and plan.

**Changes:** no `migrations/**`, `src/db/**`, `src/auth/**`, `src/rpc/**`, `src/index.js`, `legacy/**`, Cloudflare configurations or UI assets. No D1 tables, imports or external data writes. Original file content is read-only for parity tests; no source code is copied into the production module byte-for-byte (the read-only projection is adapted to explicit data inputs). Roll back by reverting the PR.

## Acceptance

1. Source-vs-adapted output match for Customer ID and relation snapshot, split Cash/Bank/Mobile, change, partial dues, unpaid and over-tendered legacy drafts.
2. Bad/corrupt saved JSON falls back exactly as original; invalid split account or overpay throws the same failure.
3. No mutation of source row, input accounts or shop settings; no authorization or database access.
4. `node --test tests/m06-draft-preview.test.mjs`, full `npm test`, `npm run verify:source`, `npm run build:frontend`, syntax/diff checks pass.
5. Real authenticated Worker draft RPC, versioned drafts, number allocation, posting, printing and browser parity remain **blocked** on M02-P/M03/M04/M05/M08 gates and are explicitly out of scope.
