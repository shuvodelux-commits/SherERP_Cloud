# Superpowers M06 — Posted invoice read model, source parity

Date: 2026-11-15. Source: frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Base: GitHub `main` after merged #76.

## Goal

Create one **pure, read-only** posted-sale invoice projection in `src/modules/sale-invoice-read-model.js`, retaining the source `Invoice.gs::buildInvoicePayload_` semantics. It takes an already-authorized, source-shaped snapshot of SALES, SALE_ITEMS, PRODUCTS, CUSTOMERS, SALE_PAYMENTS, settings, shop branding, and (when available) the independently computed current settlement. The original checkout payment breakdown stays immutable and separate from later customer collections. Never infer/merge a Customer by phone or display name; selected Customer ID remains authoritative. All I/O, user permissions and D1 reconciliation stay outside this module.

## Context and boundaries

- The original `Invoice.gs` builds a print payload from multiple GAS-backed sheets, including shop branding and an optional logo resolved in Drive. The read-only Worker projection must use **explicit trusted inputs** instead. `shop` is provided by an authorized settings/branding adapter, not fetched through a GAS API.
- Reuse merged M06 `readSalePaymentBreakdown_` verbatim from `src/modules/sale-payments.js`; legacy invoices synthesize a historical single tender. For Payment Detail Version=1, only active child rows and their integrity/revisions determine immutable checkout tender evidence, including cash change as metadata. Current settlement is a separate supplied trusted snapshot.
- Respect fail-closed missing, duplicate, deleted invoice headers. Show the original invoice ID, date-only date, time-only time and due date based on configured payment terms. Date scope is canonical D1 yyyy-MM-dd / ISO timestamp strings; no GAS Date, locale or generated clock is accepted as hidden input.
- This is **not** `findInvoice` RPC, a transaction writer, a print UI modification or a D1 read repository. No new migrations or public Worker DB bindings. M03 owns D1 read adapters, M04 owns permission `pos.view`, M05 owns stock, M08 owns settlement.
- Parallel M06 PR #78 owns **draft invoice preview**. Do not edit its files; this PR owns only a new posted-invoice read model, test oracle, tests, and docs.

## Acceptance / TDD

1. **RED:** Create tests that execute original `legacy/source/Invoice.gs` with the original frozen `SalePayments.gs` in an independent VM and compare the output to the not-yet-existing pure module. Assert source fixture parity for split Cash+Bank (cash change), later Customer settlements, no-data fallback, multiple invoices/products, relation snapshot vs legacy Father, historical legacy tender, all-Due v1 with no children, date/year rollover, missing/deleted/duplicate headers, corrupt payment revision/amount, invalid explicit inputs and immutability. Observe the expected missing-module error.
2. **GREEN:** Implement the smallest pure function `projectPostedSaleInvoice(invoiceId, snapshot)`. Keep existing source-shaped keys in the return; the exact selected source Customer ID is maintained, and source invoice fields are not silently rewritten by settlement.
3. **REFACTOR:** Limit duplication; no mock D1 or shadow accounting implementation. Preserve existing `readSalePaymentBreakdown_` validation.
4. **VERIFY:** Targeted Node source oracle, full repository tests, 84 original source manifest, 36-include frontend build, GitHub Actions (and existing combined real Workerd/D1 regression). No live production behavior claim.

## File / RPC / financial impact and rollback

New: `src/modules/sale-invoice-read-model.js`, `tests/m06-posted-invoice-read-model.test.mjs`, `tests/fixtures/m06-posted-invoice-oracle.mjs`, this plan. **RPC before/after:** unchanged. **SQL/Tables/Cloudflare bindings:** none. **Cash, Bank, Customer AR, Supplier AP, Party, stock, journals:** zero writes. No source files edited. Revert this PR to restore previous behavior; no production data to migrate or roll back.

## Remaining release gates

Authenticated read, D1 source-shaped repository and verified Party ID/account mapping, real M04 RBAC, M05 FIFO/lot and M08 settlement materialization, invoice printing/browser E2E and full posted-invoice parity are still required before exposing `findInvoice` or claiming POS complete.
