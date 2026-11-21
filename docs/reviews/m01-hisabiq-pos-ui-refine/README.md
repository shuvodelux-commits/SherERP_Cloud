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

## Second refinement pass after merged HisabIQ application shell (#860)

**Integration base:** main@9670c5e2 (HisabIQ shell / sidebar merged).
The previous Owner-only POS worktree was committed and rebased without
overwriting shell, Party, Auth, POS writers, D1 or original legacy files.

### Actual UX enhancements beyond first pass

- Added source-connected **Regular sale / disabled Installment sale** selector.
  Disabled installment identifies the missing Shop D1 contract.
- Added walk-in customer picker + collapsible invoice details and retained
  original name, phone, guardian, address, customer-id lookup and required
  field validation. Required customer details expand on checkout attempt.
- Added Payments with Exact / ৳2,000 / ৳5,000 shortcuts wired to original
  Amount Received input and source recalculation; no new payment engine.
  Unsupported Bank/Mobile remain disabled in Owner cash-only pilot.
- Added original-total-derived paid, change, due and amount-in-words display.
  These are presentation-only; original posting and FIFO remain authoritative.
- Added accessible **unsaved sale preview** with source cart lines, line
  totals, final amount, Escape/Tab/focus restoration and **zero POSTs**;
  F2 focuses source product search, F8 Amount Received, F9 previews.
- Moved current-D1 capability warning inside checkout when multiple lines,
  discount, due or unsupported payment are present.
- Fixed 1024px document overflow after shell #860 by compacting the Owner
  POS user avatar trigger at 1024–1199px in the POS-only stylesheet. Actual
  offender was shell's 60px avatar+chevron, not the cart.
- Honored native hidden attributes, fixed amount-in-words DOM append and
  reset screenshot scroll position before full-page capture.

### Extended browser evidence

- Actual compiled Owner app and original source POS JS with synthetic
  authenticated Owner HTTP fixture. No fake posting success or hosted D1 use.
- Phone/top and checkout viewport captures:
  [390 top](images/390-top-viewport.png),
  [390 checkout](images/390-checkout-viewport.png).
- Desktop/top and checkout viewport captures:
  [1440 top](images/1440-top-viewport.png),
  [1440 checkout](images/1440-checkout-viewport.png).
- Light and dark:
  [390 dark](images/390-dark-after.png),
  [1440 dark](images/1440-dark-after.png).
  Original five-width light captures and before captures remain included.
- Keyboard, preview, payment, input value, document overflow and reduced
  motion checks: qa/m01-hisabiq-pos-browser.spec.mjs.

### Unchanged release gates

**Visual migration is not full business or D1 parity.** The pinned React
reference includes 2–4-unit quantity conversion, tiles Box/Pcs/Sqft,
serial/shortage dialogs, installment and split tender. This Shop's private
POST currently accepts **one in-stock Standard product, validated FIFO price,
full Cash, no discount and active Cash Session**. Unsupported controls are
disabled or explicitly labeled; no UI-only fake conversion/payment.
M05/M06 source-backed SQL-atomic posting and real Workerd D1 tests remain
prerequisites to activate those features. Original POS source is retained.

The exact /ui-refine-skill is unavailable: manual Impeccable fallback,
screenshot inspection/refinement and Playwright were performed; skill-specific
invocation stays **unverified**. Review exact PR head CI and real D1 tests.

### Focused interaction captures

- [390 Customer details expanded](images/390-customer-details-viewport.png)
  shows the source name/phone inputs rather than a replaced data model.
- [390 keyboard search popup](images/390-search-popup-viewport.png)
  shows the source product selection popup before Enter → Quantity → Enter.
- [390 unsaved preview](images/390-preview-viewport.png)
  shows the preview dialogue without executing a sale POST.

### Final local verification after second refinement

- Focused real compiled Owner POS contract + Chromium Playwright suite:
  **17/17 PASS** at 320, 390, 768, 1024, 1440px, light and dark.
- Additional dark contrast regression added after screenshot inspection:
  **1/1 PASS**, explicit DOM computed colors for subtotal and payment input.
- Targeted customer / cash / product-combobox interaction captures:
  **3/3 PASS**; screenshot evidence above.
- Existing compiled Owner ERP regression:
  **7/7 PASS**, including Supplier, Purchase, auth/session, stale read and
  no-public-RPC checks.
- Existing local **real Workerd/Shop D1** M03 cash sale suite:
  **4/4 PASS** — one original FIFO lot consumption + exact Cash Book row;
  denial of unsupported modes/no session/wrong Shop/oversell/changed price;
  concurrent last-unit and rollback; private Owner invoice read/replay.
  This is regression of the existing reviewed writer, **not** new M01
  multi-unit payment functionality, and not a hosted production D1 test.
- Build: npm run build:owner-frontend PASS.
- Source manifest: 84 original files verified; docs check PASS; existing
  HisabIQ design-system + shell contract tests: 7/7 PASS.
- Used isolated worktree-local dependencies to run Workerd; the worktree
  had previously symlinked a shared node_modules missing hono. No dependency
  specification or lockfile was modified.
- Visual reviewer inspected actual reference/source and compiled target
  images, corrected desktop gap, 1024 shell overflow, legacy hidden banners,
  amount-in-words node, preview positioning and dark subtotal/input contrast.
- No hosted D1 save, Cloudflare deploy, real OAuth login session, actual
  multi-unit inventory post, split tender, credit/customer ledger, installment
  or source-component byte parity was tested or enabled by this PR.
