# M06 — Source-Parity Posted Invoice Reprint Read Model

**Date:** 2026-11-15
**Owner:** M06 read-only contract; M03 owns D1 repository/atomic posting and M04 owns protected RPCs.
**Authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Invoice.gs::buildInvoicePayload_` and `SalePayments.gs::readSalePaymentBreakdown_`.
**Status:** isolated internal preparation only — `PARALLEL-MODULE-READY=false`.

## Design decision

The previous #78 draft preview does not cover **already posted** invoice reprints. The original `buildInvoicePayload_` combines one invoice header, its exact payment children, sale item rows, product units, optional original Customer relation fallback, shop settings and current settlement snapshot.

Rejected: enable the GAS endpoint directly as Worker RPC (not authenticated); introduce duplicate SQL/accounting tables or a new settlement writer (cross-module ownership). Selected: a tiny pure read model with explicit pre-authorized rows and resolved settlement/shop inputs.

## Contract

`projectPostedInvoice(invoiceId, {saleRows,itemRows,productRows,customerRows,paymentRows,settings,settlement,shop})` maps already-read source-shaped rows to the exact original `buildInvoicePayload_` output. No datastore/query/public route; it must not infer user identity or permit client-provided rows in a public API.

- Reject no match, duplicate invoice ID and deleted invoice; no guessing.
- V1 `SALE_PAYMENTS` authoritative. Reuse `readSalePaymentBreakdown_` to reject incomplete or inconsistent active children. Old unversioned invoices get original synthetic legacy display **only**, with no stored child backfill. An all-due V1 invoice can have zero active children.
- Checkout `originalPaidAmount` and `payments[]` remain unchanged by later customer ledger payments. Current `paidAmount`, `dueAmount`, `paymentType`, `paymentStatus`, `customerCreditUsed` use an **already-authorized, independently computed** `settlement` snapshot; no new financial calculation or netting.
- New invoice relationship snapshot beats currently edited Customer master. For old invoices with no saved relation, use the exact selected legacy `Customer ID` to resolve historical Father name, never phone/name matching.
- SALE_ITEMS unit fallback uses current product units, with a blank if deleted. Item/sale/order values are otherwise source-shape-preserving.
- Source `safeDateOnly_`, `safeTimeOnly_` accept canonical serialized D1 text; future repository must guarantee Asia/Dhaka normalization for actual Date objects. Due date is blank without configured positive terms and displays YYYY-MM-DD otherwise.
- `shop` is already built by a trusted settings/branding service. No attempt to use Google Drive/logo APIs; print templates/DOM untouched.

## Affected files

New `src/modules/posted-invoice-preview.js`, `tests/m06-posted-invoice.test.mjs`, `tests/fixtures/m06-posted-invoice-oracle.mjs`, this spec/plan. **No** `src/db`, `src/rpc`, D1 migrations, source files, UI, worker config, Cloudflare secrets or remote data writes. Rollback: revert this scoped PR. No customer, cash/bank, Party, invoice, stock or ledger mutations.

## Acceptance

Run RED on the missing module in draft PR GitHub Actions, then GREEN from source-vs-port output/error tests covering split/legacy/totally-due, customer lookup/snapshot and unique ID, settlement vs original tender, payment-child corruption and canonical print fields. Require fresh full CI including local real D1 regression (unaffected), source provenance and build. **Never claim the real `findInvoice` endpoint or M06 is implemented by this read model.**
