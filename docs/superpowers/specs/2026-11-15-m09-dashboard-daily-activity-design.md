# M09 Operational Dashboard Daily Activity Parity — Design

**Date:** 2026-11-15  
**Source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Dashboard.gs`, `Utils.gs` and `dashboard.html`.  
**Owner workflow:** GitHub-only, source-oracle RED → minimal GREEN, KISS.

## Problem / delivery boundary

The original `getDashboardStats` computes four daily operational cards from already active source tables. These are independent of the unsettled M05/M07/M08 SQL financial-model rollout and can be projected from explicit, authenticated, trusted read snapshots before an endpoint is wired. The live RPC and all balance/stock/cash-related tiles remain gated. Preserve the original frontend and field names.

## Alternatives

1. **Enable full Dashboard now:** rejected—depends on active finance account balances, cash and stock projections, D1 auth and record-level reconciliation.
2. **Reinvent SQL aggregation immediately:** rejected—the read adapter should prove the source's return-date and collection semantics first, before indexing/query design.
3. **Selected:** one pure function accepting an explicit shop-local `today` and trusted, already-active source-shaped records, returning only four named daily fields. Use pinned source `getDashboardStats` (with mocked unrelated dependencies) as executable oracle; no auth/network/cache/SQL/UI integration.

## Contract

`projectDashboardDailyActivity(snapshot,today)` returns exactly:
`{todaySalesTotal, todayCollectionTotal, todayExpenseTotal, todayPurchaseTotal}`.

The trusted `snapshot` contains arrays for `sales` (`SALES`), `salesReturnItems` (exact `activeSalesReturnItems_()` semantic, i.e. active child rows AND their active parent returns), `customerLedger` (`CUSTOMER_LEDGER`), `expenses` (`EXPENSES`), `purchases` (`PURCHASES`). **An authorized D1 caller must apply the same active-row and return-parent filters before calling**; the adapter does not query or authenticate. All `Date` values are already normalized `YYYY-MM-DD` or blank, never raw timestamps/UTC-coerced dates. `today` must be a valid trusted shop-local `YYYY-MM-DD` value (reuse M09 date-default validator).

- `todaySalesTotal`: sum active invoices whose business date is `today`; deduct active returned line value **against the original sale date**, including new `Pricing Basis: NetAfterInvoiceDiscount` and old pre-discount returns scaled by the invoice `Grand Total / Subtotal` factor; round as source. If no today sales, zero despite other return rows.
- `todayCollectionTotal`: today's POS `Paid Amount` (nonnegative) plus today's active CUSTOMER_LEDGER `Type: Payment` money (nonnegative). Use explicit `Payment Amount` when present, otherwise `Credit - Discount Amount`; settlement discounts are not money.
- `todayExpenseTotal`: today's active expenses except `Status: Cancelled`, using `Amount`; no source-created `Is Deleted` check is added because the D1 reader must prepare active rows.
- `todayPurchaseTotal`: today's active purchases' `Grand Total`; no return subtraction here, matching the original card.
- Refuse duplicates of a selected today's `Invoice ID` anywhere in the active sales snapshot, including another date, as `assertUniqueSalesInvoiceIds_` does. Never silently map such invoices by last-writer-wins.
- No mutation. Fail closed on absent/malformed snapshots, pending Promise instead of array, getters/inherited properties, invalid date-only cells or invalid `today`.

Financial note: no combined Party due, no historical opening balances, no netting, and no bank/cash ledger writes. Later M09 read-model SQL must maintain seven Party role balances separately per ADR-007, and compare identical migrated datasets against source oracle for the remaining dashboard cards.

## Test acceptance

- Assert full original `getDashboardStats` four-field projection for overlapping date/return cases, discounts, payment fallback, negative amounts, canceled expenses, purchases and rounding.
- Native source oracle uses exact `Dashboard.gs` helpers and `Utils.gs` `economicReturnLineAmount_` / `roundMoney_` and duplicate guard inside a Node VM; only GAS-dependent fetch, clock, auth, unrelated card dependencies are injected.
- Include explicit regressions for backdated invoices (business date beats created date), same-day return against old invoice, duplicate invoice collision, synthetic blank date, future and prior days, unknown trusted input.
- RED: tests fail because adapter is missing; GREEN: all new tests and existing GitHub Actions pass on the exact final commit.
- No public Dashboard RPC registration, production D1, actual account data, browser changes or claim of end-to-end dashboard readiness.
