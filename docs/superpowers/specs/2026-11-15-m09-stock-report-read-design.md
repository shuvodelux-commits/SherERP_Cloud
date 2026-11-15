# M09 Stock & Valuation Report — Original Source Parity Design (2026-11-15)

**Pinned authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/Reports.gs::getStockReport`, original `reports.html`. Built after merged M09 #173.

## Objective

An isolated, deterministic, read-only projection matching source `getStockReport` from independently authorized source-shaped `activeRows_('PRODUCTS')` and **all** `getAllRows_('STOCK_LOTS')`. The source is a current snapshot with **no date range**, unlike Sales/Purchase Reports. Do not create D1 queries, public RPC endpoints, frontend changes, or an alternate FIFO/posting engine.

### Source behaviors to preserve

- Include every already-active/nondeleted Product, including `Status: 'Inactive'`, in the returned `products` table. `products.length` is the total row count, while `activeProducts` and inventory/retail totals include only rows whose Status is **not exactly** `'Inactive'`. Blank status outputs `'Active'` while lower-case `'inactive'` remains active.
- Scan **all** supplied Stock Lot rows; ignore lots whose `Number('Remaining Quantity') || 0 <= 0`; sum `qty * (Number(Purchase Price)||0)` and lot quantities by original Product ID. Include inactive-product lot value *in that product's detail row* but **exclude** it from aggregated active cost and categories. Orphan lot groups are not added to product rows or active totals.
- Stock is the source `Number(Current Stock)||0` fast-read cache. `lotMismatch` is **strict numeric inequality** `lotQty !== stock` only for active products. Never silently correct stock from the lot ledger.
- `retailValue` is `stock * (Number(Selling Price)||0)` even for negative stock; `potentialMargin` is `retailValue - inventoryValue`. Do **not** round any stock/cost/retail figure: the frozen source does not call `roundMoney_` here.
- Among active products, `outOfStockCount` is stock <= 0; `lowStockCount` is **positive stock** <= Minimum Stock (mutually exclusive with out-of-stock). However `lowStock` detail array includes **all** active products with stock <= minimum, including out-of-stock. Preserve this asymmetry.
- Products are sorted descending by lot value (stable ties); `byCategory` is sorted descending by aggregate category lot value, `products` count and total stock include active products only. Original categories default to `'Uncategorized'`, Unit defaults `''`, Status defaults `'Active'`.
- Return response exactly: `{totals:{products,activeProducts,inventoryValue,retailValue,potentialMargin,lowStockCount,outOfStockCount,mismatchCount},byCategory,products,lowStock}`.

### Trust boundary, alternatives and failure paths

Future caller must authenticate and enforce `reports:view`, provide already-active Product rows and all source-equivalent Stock Lot rows from reviewed M05/M07/FIFO D1 reads; the original lot reader may include historical/non-active lot rows, so do not preemptively alter what `getAllRows_('STOCK_LOTS')` includes. No client-selected SQL columns/tables or unreviewed D1 bindings.

Option A — use lot values to rewrite master Current Stock or calculate FIFO sales COGS: **rejected**, source only displays mismatch, and doing either would be an unsafe inventory mutation. Option B — fully expose live Stock RPC now: **rejected**, upstream authorized D1/stock reconciliation unapproved. **Selected:** minimal pure projection with original GAS executable oracle.

Fail closed on invalid/missing snapshots, Promise arrays, accessor/inherited rows, nonfinite numeric quantities/costs and ambiguous duplicate selected Product IDs. Duplicate product IDs were not guarded by the frozen source; rejection is an intentional corruption-only safety improvement (explain divergence). Do not auto-dedupe by category/name, infer Party links, or delete orphan lots.

## Verification, impact and rollback

- New executable `node:test` source oracle loads `getStockReport` + `sortedByDesc_` from the frozen original, executes in `node:vm` with source fixtures, and checks entire result, totals, grouping, stable tie order, inactive and orphan lots, negative stock, mismatch and source coercion; explicit invalid/duplicate fail-closed tests.
- New four files only: spec, plan, `tests/m09-stock-report-read.test.mjs` (RED), `src/modules/stock-report-read.js` (GREEN). Test first and *observe* expected RED in GitHub Actions before runtime code.
- Run source verification, full Node suite, original frontend build, all exact-head GitHub CI, Chromium desktop/mobile/A4, and existing isolated local D1 checks. Distinguish native source VM unit parity from a real live authorized D1 stock report.
- Unchanged: original GAS, frontend and DOM, `getStockReport(token)` RPC registration, Worker auth, SQL schema, D1/data migrations, FIFO and lot posting, cash/bank, Party role accounts. **Rollback:** revert four isolated files, no live data to restore.
