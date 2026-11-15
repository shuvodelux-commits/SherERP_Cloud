# M06 — Source-faithful POS invoice lookup by phone (internal read-only)

**Date:** 2026-11-15
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Invoice.gs::findSalesByPhone`, `Utils.gs` phone/date/duplicate helpers.
**Status:** isolated preparatory read model only; `PARALLEL-MODULE-READY=false`.

## Goal and selected approach

The merged M06 #82 posted-invoice read model builds one invoice reprint payload; it does not implement the original POS search/history results. This increment prepares the *read-only list projection* that can eventually sit behind an M04-authenticated `pos.view` endpoint. The source searches by phone **or explicitly requested legacy Customer ID**, orders by Created At descending, marks duplicate invoice IDs and displays *current* payment status only for eligible nonduplicate due invoices.

Rejected: expose `findSalesByPhone` over Worker RPC (requires M04 authentication, tenant scoping, source-shaped D1 reads); reimplement customer ledger replay or duplicate finance accounting (M08/M03 ownership). **Selected:** `projectPosPhoneInvoiceHistory(phone, customerId, {activeSales, currentSettlementByInvoice})`, a pure Worker-compatible projection with only explicit, already-authorized data. Its behavioral oracle runs original `Utils.gs` and `Invoice.gs` in a test-only VM.

## Contract

- Input `activeSales` must be a **trusted, tenant-scoped, already-filtered active SALES snapshot**; the caller owns M04 `pos.view` and M03 D1 query policy, never receives rows from the browser. `currentSettlementByInvoice` is a trusted **read-only** map of invoice-specific snapshots already computed by the M08 Customer settlement authority; no new ledger calculation.
- A missing/blank phone produces the same `Enter a phone number.` failure, even when `customerId` is specified, matching source.
- Phone comparisons support original Bengali numerals, `+880` and `01...` normalization. Phone is only a **search field**, not proof for unifying Party identities.
- Match a sale if the requested Customer ID is nonempty and equals saved `Customer ID`, **or** the canonical phones match. Do not silently choose one match if two distinct parties share the number; preserve every source result.
- Sort matches by `Created At` descending (not backdated `Date`). Return source keys `invoiceId,date,time,customerName,grandTotal,paymentStatus,duplicateInvoiceId`; date/time use already serialized D1 canonical text.
- Duplicates are computed over the **whole active SALES snapshot**, not just matches. Mark duplicates and never override their stored payment status with a settlement snapshot. No invoice ID collision resolution occurs in the projection.
- Apply current settlement `paymentStatus` only when the invoice is nonduplicate, has a tracked Customer ID and source `Due Amount > 0.004`. A cash-only walk-in, no-due sale or collision never gets a fabricated post-sale status.
- Do not create or merge Party identities, auto-net accounts, post Cash/Bank or amend original SALE rows.
- This is not an auth guard, endpoint or D1 adapter. Future endpoint activation must enforce tenant isolation, permission, bounded results, rate limits and privacy controls separately.

## File boundary and acceptance

Only new `src/modules/pos-invoice-phone-search.js`, `tests/fixtures/m06-phone-search-oracle.mjs`, `tests/m06-phone-search.test.mjs`, this spec and plan. No changes to `src/db`, schema/migrations, `src/rpc`, auth, `legacy/**`, frontend/print assets, config, staging/production Cloudflare or remote data. Recovery is reverting the PR.

RED missing module must fail in GitHub CI; GREEN original-source parity tests must cover phone formats, exact legacy Customer ID fallback, same-phone distinct parties, duplicate IDs, current settlement eligibility, ordering, lack of phone, nonmutation and trusted-snapshot rejection. Full Node suite, Workerd/D1 regression CI, immutable source manifest and frontend build must remain green. No real POS browser flow or public search RPC is claimed.
