# M01 HisabIQ Product Table — visual parity and scoped QA

**Source reference:** `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484` (`src/pages/Products.tsx`, table components, product visible-column preferences).
**Target:** authenticated `Owner` Product page, assembled from frozen SherERP legacy source during the Owner build. No D1, RPC, auth, POS, Party, Seller, Supplier, Product-write policy or original HTML source changes.

## Scope and deliberate guards

- All **nine reference columns**, in reference order: `#`, Product, Category, Stock, Stock value, Unit, Purchase, Selling, Status; original Owner-only read-only Actions column retained. Original sortable headers and filterable source rows stay routed through original functions.
- Columns popup: persist preferences in local storage; do not allow hiding **Product, Stock or Selling** even when storage was tampered. Keyboard Escape, ArrowUp/Down, Home/End, responsive menu position and checked state.
- Keyword search and clear, original Category and Brand source filters, reference-style Category chips, Stock All/Low/Out toggles, visible row ordering, empty-state recovery and responsive horizontal scrolling.
- Category/brand filtering and product stock group calculations only read the existing authenticated source data; they never mutate source, authorizations, balances or historical receipt rows.
- Owner backend currently exposes **stock at backup**, not guaranteed live stock, and **Stock Value is unavailable**. This is visibly marked in the source columns. The Low/Out UI classifies those displayed stock values only; it must not be advertised as a live reorder or valuation authority. The new UI does not activate original source edit/adjust/lot/delete actions without explicit authorized backend contracts.
- Product initials are fallbacks, not actual product photos; real image media and multi-unit conversion metadata are not currently delivered in the Owner catalog payload. Keep source permissions fail-closed.

## Before/after matrix — same merged Owner shell

The test fixture installs the merged current Owner shell, then removes **only** the proposed Product adapter for its `before` capture, rather than comparing an older unrelated Shell build. Both captures use the same synthetic **unconnected** Owner read, synthetic products, source categories and no financial write calls.

| Viewport | Before | After |
| --- | --- | --- |
| 320px phone | [before](images/320-before.png) | [after](images/320-after.png) |
| 390px phone | [before](images/390-before.png) | [after](images/390-after.png) |
| 768px tablet | [before](images/768-before.png) | [after](images/768-after.png) |
| 1024px desktop | [before](images/1024-before.png) | [after](images/1024-after.png) |
| 1440px wide desktop | [before](images/1440-before.png) | [after](images/1440-after.png) |

Additional Playwright states: [390px column menu](images/390-column-menu.png), [1024px Low stock filter](images/1024-low-stock.png), [320px empty state](images/320-empty-state.png).

## Visual review and differences addressed

1. Original phone UI transformed the Product table into large stacked cards; the approved reference keeps a dense product table with a horizontal scroll region and right-sticky Actions column. Scoped CSS restores this layout at 320px and 390px while retaining all fields inside the scroll surface.
2. Matched 12px column headings, 13px data rows, Geist / Hind Siliguri, 34px thumbnail placeholder, compact 36px controls, Ink/Teal tokens, row dividers, source stock warning tones, 12px panel radius and semantic focus rings.
3. Toolbar wrapping at 320/390/768/1024/1440 keeps search, categories, Stock tabs, Brand and Columns usable. The Brand source filter remains visible on phone; the unit and prices are scrollable, not silently deleted.
4. First Playwright test found a true error in the Low/Out button: already decorated rows did not change visibility. Added a per-refresh row visibility update, then reran the actual browser filter test to GREEN.
5. After merging Shell PR #860, a previous synthetic test forcibly set `#app.style.display='block'`, causing the sidebar to stack above products and block the Category chip. The corrected fixture exercises `goToPage('products')` with its **real shell layout**, and the Product Table interactions pass. Product code does not override shell flex layout.
6. At 1024px the **merged shell topbar** can extend the document width by ~21px although the Product Table card stays within viewport and its horizontal scrolling remains isolated. A dedicated follow-up is needed for the shared Shell; avoid touching that parallel-owned shared CSS in this Product-only PR.
7. `data-hisabiq-design-system` attaches only to the Product page. No global CSS rule, global typography or financial display conversion is introduced.
8. Final phone screenshot review revealed original Owner source replacement had removed `.erp-sticky-action-col` from the read-only Actions cells. Added a failing 320px Chromium test for header/body position alignment, restored the sticky class without adding any action, confirmed RED → GREEN and recaptured phone screenshots.

## Tool verification scope

`/ui-refine-skill` itself is **not installed in this agent environment**, so do not count that exact skill as executed. Used the available Impeccable visual-review guidance and **actual Playwright Chromium screenshots**, inspected phone and desktop before/after, fixed observed defects, and reran browser/regression tests. All screenshots use synthetic session/source fixtures—not a hosted production/real-D1 acceptance test. GitHub checks and live deployment remain separate gates.

**Commands:** `node --test tests/contract/m01-hisabiq-product-table.test.mjs qa/m01-hisabiq-product-table.spec.mjs qa/m03-owner-erp-browser.spec.mjs qa/m01-hisabiq-shell-browser.spec.mjs tests/hisabiq-design-system.test.mjs`; `npm run build:owner-frontend`; `git diff --check`.

## CI wiring

The Owner Product Table Chromium suite is included in existing `npm run test:m01:browser`, used by PR-only `.github/workflows/m01-browser-qa.yml` (no new deployment workflow or secrets).
