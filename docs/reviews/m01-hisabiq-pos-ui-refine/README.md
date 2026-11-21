# M01 Owner HisabIQ POS V2 parity — visual/browser review

**Status:** UI composition migration only; exact source feature parity and live D1 checkout remain **UNVERIFIED**. Do not retire legacy POS.
**GitHub base:** `SherERP_Cloud@71aabc89`.
**Visual source:** `hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`;
`docs/ui-refine/app-pos/screenshots/round-3-main-desktop-light.png` and
`round-3-main-mobile-light.png` from pinned reference repo.

## Source versus target findings (screenshots inspected, not inferred)

- **Before:** legacy POS V2 uses blue highlights, mobile Cart/Customer/Payment tabs hide part of checkout, and the quick product catalog stays hidden.
- **After:** Owner-only HisabIQ teal/Ink tokens, 36px controls and 48px final sale button; cart and quick-item product buttons remain backed by the original `posState` handlers.
- **Desktop:** a real left-column container keeps the cart directly above quick items; right customer/payment/checkout panel is independently height-sized. First inspection caught and corrected a tall unwanted empty gap.
- **Phone:** cart/quick items/checkout stack vertically at 320/390px, no forced side scroll. First inspection caught mobile banners for inactive update/draft/conflict states being accidentally displayed; removed that override and verified they stay hidden.
- **Keyboard/route:** F2 Search button focuses the real cart product search. Original Draft/Add Product buttons are moved, never cloned, retaining original source handlers and authorization.
- **Data:** tested with a synthetic authenticated Owner read-only HTTP fixture, real compiled Owner HTML and real Chromium. No D1 data or sale posting tests are represented by these screenshots.
- **Outside scope:** original `legacy/source`, source manifest, D1, Workers routes, security, pricing/FIFO and accounting unchanged.

## Evidence: actual Chromium Owner UI screenshots

| Width | Before | After | UI assertions |
| --- | --- | --- | --- |
| 320px phone | Source reference above | [320 after](images/320-after.png) | no document overflow; all three sections visible |
| 390px phone | [390 before](images/390-before.png) | [390 after](images/390-after.png) | stack, cart quantities/removal, checkout |
| 768px tablet | Source reference above | [768 after](images/768-after.png) | stacked tablet, no clipping |
| 1024px desktop | Source reference above | [1024 after](images/1024-after.png) | split cart and checkout |
| 1440px desktop | [1440 before](images/1440-before.png) | [1440 after](images/1440-after.png) | split, live quick items, teal totals |

Raw browser measurements: [qa-results.json](qa-results.json). Each screenshot includes two products added using existing source UI. Images are generated from the actual compiled Owner HTML, with safe synthetic product data. The baseline screenshots remove only the new CSS and presentation controller from the same Owner build.

## RED/GREEN and gates

1. RED: 2/2 new contract tests failed because the Owner POS injector and visual assets did not exist.
2. GREEN: 12/12 new focused tests pass after implementation and browser refinement, including 320/390/768/1024/1440, quantity 1→3, live total recomputation and item removal, route reactivation/Drafts, hidden source banners and zero sale POSTs.
3. `npm run verify:source`: 84 original files verified untouched.
4. `npm run docs:check`: 3 core documentation links verified.
5. `node scripts/build-owner-frontend.mjs`: compiled Owner private app generated successfully.
6. Existing Owner ERP regression suite: **track separately**; no statement of passing until it completes successfully. GitHub CI final gate required.

## Gaps, controls and release blockers

- **Exact pixel-level/source-component parity NOT achieved:** source is React/TSX; current target remains compiled legacy HTML/JavaScript. This change transfers source layout/tokens and preserves target operations without importing unverified React controllers.
- **Multi-unit compound quantity input NOT ported to live D1 checkout:** source supports one joined 2–4 unit entry; current Owner POS source cart has a single quantity and unit. Adding a visual selector without an atomic D1 conversion/stock/price contract would be misleading and financially unsafe.
- Original customer form is kept, not replaced by HisabIQ CustomerPicker. Source templates, installment, split tender, product serial/shortage and any feature requiring backend API are not falsely advertised.
- The rest of the Owner app shell has the existing legacy nav/header. A complete visual copy requires a separate shell integration against the pinned HisabIQ design system.
- `/ui-refine-skill` itself is unavailable in this runtime. The closest installed Impeccable skill/playbook and actual before/after screenshot inspection were used, but the skill-specific gate remains **UNVERIFIED**.
- No production Worker deploy, database migration, real authenticated D1 cash sale or negative/positive stock proof. Source/legacy POS is preserved until business/integration sign-off.

**Rollback:** revert this scoped PR; the older compiled Owner POS remains present and operationally unchanged.
