# M01 — HisabIQ Dashboard Step 3 of 3: Safe Drilldowns and Final UI Acceptance

**Issue:** #567. **Workstream:** M01 front-end; source visual PR #570 is merged.
**Integrated dependency:** Step 2 PR #588 merged into main as `1dd09e6d8d2902cc5a4fdd0ee4159e81a0b85bdd` on 2026-11-17. Initial stacked Step 3 #597 was superseded due to squash-history conflict. This clean branch starts from the verified merged main SHA and targets **main** directly.
**Main at clean branch creation:** `1dd09e6d8d2902cc5a4fdd0ee4159e81a0b85bdd`.
**Owner:** M01, limited to `src/ui/hisabiq-dashboard.html`, `qa/m01-browser.spec.mjs`, `tests/m01-hisabiq-dashboard.test.mjs`, and this plan. Concurrent M01 Products UI PR #581 owns separate files. 
**Read/write surface:** purely compiled client HTML/JS/CSS and synthetic browser tests; no financial transaction, Worker RPC, migrations, source GAS, or static assets builder changes.
**Sources:** original `legacy/source/{sales,daybook,reports,products,customers,suppliers}.html` and their `goToPage` wrappers are frozen; use approved functions and existing controls.

## 12-sentence implementation overview

1. The third step closes the dashboard presentation work with correct, reachable detail navigation rather than adding fabricated invoice, chart or Party rows.
2. Every default metric, optional legacy widget and existing panel action maps to a known ERP module.
3. Navigating to Today's Sales applies the actual local business date to the native Sales Management date filters.
4. Navigating from Recent Sales applies yesterday-through-today dates to the same existing invoice list.
5. Navigating from Sales Trend selects the native Sales report tab and its last-14-days inclusive date range.
6. Navigating from Gross Profit selects the native Profit report tab with today's date range, without treating a missing gross-profit summary as zero.
7. Native Day Book, Customers, Suppliers, Products, Expenses, Finance and Purchase screens remain authoritative for their records and financial-role separation.
8. If a dedicated source filter is unavailable (for instance due-only customers or low-stock-only products), the dashboard says so and never presents a generic list as a verified filtered aggregate breakdown.
9. Before invoking `goToPage`, each click checks the current sign-in and the same original navigation/child permissions, so unauthorized clicks do not silently redirect users elsewhere.
10. A nonfinancial contextual strip in the destination explains the selected dashboard origin and any date scope, with an accessible Back to Dashboard action.
11. Source and browser tests cover desktop, mobile, restricted roles, Sales and Reports filters, honest unavailable states, preserved customization, and no source or posting edits.
12. Full current-main-targeted CI and review gates must pass before this Step 3 PR is merged; Step 3 never claims real D1 chart or Party row detail without the M09/M03/M04 source-authorized backend.

## UI contract / route mapping

| Widget | Native destination | Context |
| --- | --- | --- |
| Today's Sales | Sales invoices | Local today date filter |
| Recent Sales | Sales invoices | Yesterday to today date filter |
| Sales Trend | Reports › Sales | Last 14 days (real report, not a chart-series claim) |
| Gross Profit | Reports › Profit | Local today, real source report when available |
| Cash / Cashflow / Collection | Day Book | Date selections in original view, no misleading period reconciliation |
| Receivable / Dues | Customers | Entire customer list until due-only approved read |
| Payable | Suppliers | Entire supplier list until due-only approved read |
| Low Stock | Products | Stock column, no invented low-only data filter |
| Purchases / Expenses / Finance | Their unchanged native modules | Under original roles and permissions |

## TDD and acceptance

- RED: compiled/DOM and Playwright assertions added before implementation.
- GREEN: minimal dashboard-only route guard, report/sales scope, contextual navigation strip, and accessible failure notice.
- Cross-viewport Playwright screenshots at 320, 390, 768, and 1440, with keyboard and touch actions from Step 2 retained.
- Source account lines and read-only accounting boundaries never cross-net Customer/Supplier/Borrower roles.
- Review screenshot artifacts and current-head full CI; no merge based only on a focused browser run.
- Rollback: revert Step 3 PR while retaining Step 2 customization and Step 1 appearance.

**Remaining after Step 3 UI PR:** Live history graphs, invoices, Party due rows and exact source-data drilldowns are separate M09/M03/M04 gated integrations; they are not mocked in production.
