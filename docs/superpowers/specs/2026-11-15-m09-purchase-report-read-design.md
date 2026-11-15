# M09 Purchase Report — Source-Faithful Read Projection

**Date:** 2026-11-15  
**Source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen `legacy/source/Reports.gs::getPurchaseReport`, `Utils.gs::economicReturnLineAmount_` and `roundMoney_`, `reports.html`.  
**Design scope:** Internal pure read adapter. No new public RPC, D1 schema, SQL, authentication, posting, or UI.

## Purpose and alternatives
The original Purchase Report shows gross purchases, discounts, returns, net purchases, supplier money paid, outstanding dues, day-by-day totals and top suppliers. It attributes returns to original purchase dates, applies the parent invoice discount to older return rows, and **does not count noncash purchase-return credits as supplier payment money**.

- Full live report SQL/RPC now: rejected until M03/M04 session+permission, M05 purchases, M07 returns and M08 supplier-account reconciliation are joined and verified with real D1.
- Recalculate supplier settlement and outstanding due in M09: rejected because that duplicates the authoritative supplier ledger and risks unintended Party role netting.
- **Selected:** Source-fidelity projection from explicitly supplied, authorized active Purchases and active Purchase Return children, plus independently reconciled supplier settlement evidence. Match the GAS response shape and grouping precisely.

## Contract
`projectPurchaseReport(snapshot, filters, today)` returns `{range, totals, byDay, topSuppliers}` in the same key order as original `getPurchaseReport`.

Input:
- `snapshot.activePurchases`: exact `activeRows_('PURCHASES')` source-shaped rows; **caller** filters active/deleted records before use. Each has a canonical normalized shop-date `Date` and original `Purchase ID`. Do not auto-merge suppliers or infer due from external identity.
- `snapshot.purchaseReturnItems`: exact `activePurchaseReturnItems_()` equivalent; both return parent and child must be active; **no return date window**, since each return adjusts its parent purchase's date. `economicReturnLineAmount_` formula uses raw `Line Total` if `Pricing Basis === 'NetAfterInvoiceDiscount'`, otherwise raw times `Grand Total/Subtotal` when Subtotal positive. `roundMoney_` after each per-purchase return addition.
- `snapshot.settlementsByPurchase`: trusted own-data map keyed by source `Purchase ID`. For each selected Purchase with nonempty `Supplier ID` and initial `Due Amount > 0.004`, require own record `{paidLater, dueAmount}` of finite numbers from independently verified supplier settlement read model. `paidLater` is only actual supplier payment money; purchase-return credits, settlement discounts and source status credits **are not money**. Never substitute a fabricated zero or combine Supplier with Customer/Vendor account.
- `filters` and `today`: existing M09 `normalizeReportRange`/ `dateInReportRange` inclusive, default current shop-local month, reversed ranges normalized, no implicit clock/UTC conversion.

Output:
- `totals`: `{purchases,grossPurchases,discount,returned,netPurchases,paid,due}`. Accumulate `grossPurchases`, `discount`, `returned`, `paid`, `due` with source `roundMoney_` **after each purchase**, and `netPurchases` from final gross-minus-returned rounded.
- `byDay`: ascending original purchase date, `{label,purchases,gross,returned,net}`, rounded after each purchase.
- `topSuppliers`: largest `net` first, max 15; `{label,purchases,gross,net,due}`, original `Supplier Name || 'Unknown'`, stable tie ordering. This is a *source-name grouping*, not automatic Party identity linking.

## Guardrails and known differences
The frozen Purchase report builds `purchaseById` from rows and silently overwrites repeated purchase IDs. This is unsafe for financial report provenance. The new adapter **fails closed on duplicate selected Purchase IDs** rather than certifying ambiguous results. Note this intentional corruption-case safety divergence; normal unique-ID fixtures must exactly equal the frozen source.

Fail closed on missing/invalid active arrays, pending Promise, getters, inherited rows, invalid date-only strings, Infinity or unknown monetary object types, absent settlement evidence, ambiguous selected purchase IDs. No mutations, hidden caches, SQL identifiers or permissions granted. Tests execute frozen `getPurchaseReport` with real source helper bodies in Node VM and inject deterministic supplier settlement state **as an oracle fixture only**, not D1 integration proof.

## Acceptance and handoff
- Test-first RED commit and observed GitHub Actions expected missing adapter failure.
- Minimal GREEN pure adapter and exact-response oracle tests, full Node suite, source 84-file verifier, legacy frontend build and existing PR jobs. Clearly distinguish source-VM unit proof from authorized real-D1 report integration.
- New four-file change only: `docs/superpowers/specs/2026-11-15-m09-purchase-report-read-design.md`, `docs/superpowers/plans/2026-11-15-m09-purchase-report-read.md`, `tests/m09-purchase-report-read.test.mjs`, `src/modules/purchase-report-read.js`.
- Source GAS, `reports.html`, Worker, RPC registry, D1 schemas, sales/purchase/returns writers, settings, finance and Party remain untouched. **Rollback:** revert four isolated files; no data impact.
