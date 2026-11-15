# M06 Sale Update line-total preservation — design

**Date:** 2026-11-15. **Source of truth:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `SalesManagement.gs::saleUpdateLineTotal_` and the `updateSaleInternal_` per-Product-ID calculation loop; `Utils.gs::roundMoney_` and `isValidNonNegativeNumber_`. Honor target `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007.

## Problem

The legacy hardware ERP may have a historical exact (auto-priced / fractional-conversion) `SALE_ITEMS['Line Total']` that differs from newly computed `qty * visible unitPrice`. The frozen `saleUpdateLineTotal_` deliberately **keeps the original line amount exactly** when stored quantity and visible unit price are unchanged within a `1e-9` tolerance and the saved amount is nonnegative and finite. When either value changes, when the line is new or the saved amount is blank/invalid, it returns the original `roundMoney_(qty * unitPrice)` result. The caller then rounds the accumulated invoice subtotal **after each line**. Recalculating unchanged lines can silently create a BDT rounding discrepancy during an edit.

## Scope and contract

Add one **internal, read-only** `planSaleUpdateLineTotals(invoiceId,oldItems,newItems)`. Inputs are source-shaped `SALE_ITEMS` rows already tenant-scoped and authenticated by M03/M04, plus validated POS-edit candidates `{productId,name,qty,unitPrice}` for one invoice. Filter old rows by explicit exact `invoiceId`, retaining **first** matching old row per Product ID as the frozen writer does. Reject missing/ambiguous or malformed trusted inputs, duplicate new Product IDs, nonfinite/negative price and nonfinite/nonpositive qty. Do not infer identity from a name or phone.

Return a pure projection `{subtotal,lines}` with `lines:[{productId,qty,unitPrice,lineTotal}]` in submitted order. For each line, preserve the exact source historical amount only on unchanged qty/visible unit-price with valid stored `Line Total`; else source money rounding; subtotal is sequential `roundMoney_(subtotal + lineTotal)`. Historical values may contain more than two decimal digits and must not be prematurely rounded if the line is unchanged. Fail closed for nonsensical overflow or non-finite values; this migration guard is intentionally stricter than source for untrusted numeric extremes.

This helper **does not** validate invoice editability, Cash Session, changed Customer, stock or settlement; it must not mutate `SALE_ITEMS`, D1, Cash/Bank, ledger, FIFO or Parties. `getSaleForUpdate` and existing update-mode preflight remain independent read-side authority; actual `updateSale` must revalidate in the shared atomic D1 write boundary after M03/M04/M05/M07/M08 gates. Do not change the source GAS, original UI, Cloudflare bindings, database, RPC or other modules.

## Source-parity acceptance

A test-only Node VM executes **actual frozen source** `saleUpdateLineTotal_`, `roundMoney_`, `isValidNonNegativeNumber_` with SHA-1 Git blob verification, then independently checks every returned line and invoice subtotal. Cases include unchanged fractional auto-priced amounts, tolerance cutoff, changed qty/price, missing/blank/negative/Infinity original total, first-of-duplicate historical source row, new line, sequential rounding and no mutation. Security cases require duplicate candidate rejection, exact invoice scoping, finite money/quantity, no accessors, and no operation on malformed snapshots.

GitHub-first Superpowers RED → GREEN, then Foundation source/frontend, Workerd/D1, Chromium and Cloudflare secret-free preview CI. Draft PR and no merge until review/approval.
