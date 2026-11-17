# M09 Sales + Profit source-faithful soft-delete semantics — design

**Owner:** M09 reports only. **Issue:** #431; coordination #456. **Base:** `main@7c81dca09f975fbda37586eb50c2763c7f8506df`. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `DeleteEngine.gs::isDeleted_`, `Reports.gs::getSalesReport/getProfitReport`. **Prior dependency:** PR #491 merged on main.

## Defect and approach
The frozen deletion helper returns true for a real boolean true or `String(v || '').toUpperCase() === 'TRUE'`. Thus `'TRUE'`, `'True'` and `'true'` hide a transaction, while `'FALSE'`, `'false'`, false, numeric zero and an empty marker do not. The pure M09 Sales and Profit projectors currently test only the boolean or literal uppercase `TRUE`, allowing lowercased deleted invoices to affect revenue, profit, return attribution and FIFO-cost coverage.

The existing source-parity tests also stub `isDeleted_` with the same incomplete condition, hiding the regression. Rather than copy a revised stub, extract the *actual pinned* `isDeleted_` function from `legacy/source/DeleteEngine.gs` into each VM-hosted original GAS oracle and remove both inaccurate stubs. Add separate test-first cases for mixed-case deleted sales and false/blank live markers to each report, requiring full original-GAS projection equivalence. Then modify only the two internal projector deletion checks to match the frozen helper without changing economics.

## Exact ownership and release boundary
Modify `tests/m09-sales-report-read.test.mjs`, `tests/m09-profit-report-read.test.mjs`, `src/modules/sales-report-read.js`, `src/modules/profit-report-read.js`, plus this spec/plan. Existing report source projections are pure, internal and **not callable via public RPC**. M03 owns `src/db`, `src/rpc`, `src/index.js`, schema, worker bindings and posting; nothing here touches those surfaces. No change to frozen GAS, ERP UI, source data, money formulas, authorization, gross Party accounts or stock.

Source tests include all historic invoice rows (including soft deleted) to retain the intentional duplicate-original-ID fail-closed proof. Never infer a valid replacement ID. Any future authenticated D1 report source reader still requires M02/M03/M04/M05/M07/M08 reconciliation, M10 staging and M11 owner authorization. The public reports gate remains closed.
