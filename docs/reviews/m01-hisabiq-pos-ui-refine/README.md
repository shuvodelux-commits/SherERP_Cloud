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

## Third refinement: source-safe POS checkout preflight and invoice preview

**Source:** pinned HisabIQ React CartTable empty-state and CheckoutPanel.
**Integration base:** main@9670c5e2; PR #869 remains the same isolated
Owner M01 UI PR. No M03/M05/M06/SQL/Worker changes in this refinement.

### RED → GREEN and visual review

- **RED before code:** three new Chromium cases failed as expected:
  missing inline early rejection for unsupported multi-line checkout, missing
  source-style empty-cart hint, and preview lacking customer, discount,
  paid and due breakdown.
- **GREEN after code:** the same three passed. Two additional regression
  cases pass: eligible single-product full-Cash checkout still opens the
  **original source financial confirmation** with zero automatic POSTs; and
  before/after screenshot capture uses actual compiled Owner HTML.
- **Financial boundary:** known unsupported shapes (multiple products,
  nonzero discount, Bank/Mobile payment or partial/Due) are rejected before
  the Owner sale endpoint. The source error area exposes a focused accessible
  explanation. **This is not authorization:** supported shapes still pass
  through original source confirmation, private authentication/tenant/session
  gates, FIFO stock/price quote and SQL-atomic D1 checks.
- **Empty cart:** after the original Add Product entry row, shows the same
  bilingual empty hint semantics as pinned HisabIQ CartTable. Disappears as
  products are added, reappears when removed; original handlers unchanged.
- **Unsaved preview:** item names, quantities, units, line totals plus
  source customer/phone, subtotal, discount, payment method, paid, due and
  change, total payable. Uses textContent only (safe user input). The
  preview never saves or mutates financial input state.

**Screenshots manually inspected:**

- [320 before, old empty cart](images/320-empty-before.png)
- [320 after, HisabIQ empty cart](images/320-empty-after.png)
- [320 after, detailed unsaved preview](images/320-preview-details-after.png)

The 320px empty comparison confirms the reference-style Add Product row and
bilingual empty hint fit within the phone viewport. The preview screenshot
confirms the modal remains entirely visible, its values reconcile to the
source inputs (420 subtotal - 10 discount = 410 payable; 300 paid; 110 due),
and the Not saved status is explicit. Modal close, Escape, original confirmation
and no-post behavior are asserted in Playwright. The previous screenshots
remain as historical before evidence; do not count the static visual fixture
as a production cash sale.

**Limits:** Frontend preflight is advisory/redundant to the authoritative
Worker. It does not implement 2–4-unit conversion, split tender, Customer Due,
cash-session changes, persistent Drafts or multi-product D1 posting.
Retain original POS and do not deploy this as an operational new feature
until M03/M05/M06 integration and owner-reviewed production release gates.

### Exact CI failure triage and Customer input repair

The previously queued PR #869 GitHub runs exposed two failures at old head
48835507:

1. **Owner real-D1 Cash browser (owner-pos-cash):** the original
   #posCustomerName was hidden because M01 moved the source Name/Phone
   controls inside a closed optional details accordion. The existing
   qa/m03-mvp-cash-sale-browser.spec.mjs timed out at fill().
   **RED:** new real Chromium test reproduced invisible customer fields.
   **GREEN:** only the original Name/Phone wrappers, labels and datalists
   are now moved into an always-visible primary customer section. Optional
   guardian/address/history remain collapsible. No IDs, source event
   handlers, data or posting paths were replaced. The original real
   Workerd/D1 browser checkout + persisted invoice + reload/reprint test
   passed **1/1 locally** after this fix, and five-width UI tests explicitly
   assert Name/Phone visibility.
2. **Shared M01 shell browser (Chromium desktop, mobile and synthetic A4
   print):** qa/m01-hisabiq-shell-browser.spec.mjs:52 asserted 256px desktop
   sidebar, GitHub runner measured 254px. Shell ownership is in parallel
   PR #864, not POS. Handoff recorded at
   https://github.com/shuvodelux-commits/SherERP_Cloud/pull/864#issuecomment-7057653022;
   **no shared Shell CSS or test was edited**. Full local legacy M01
   browser suite passed **157/157**, including that shell test. GitHub
   must rerun exact latest head and review shell-owner resolution.

All 84 original source files and the Shop D1 schema/financial writer remain
unchanged. This new HTML relocation is needed for a functioning first-Shop
Cash sale; the existing D1 session/FIFO/tenant/replay gate remains intact.

### Final local acceptance snapshot, after original Cash-input repair

- **157/157 PASS**: npm run test:m01:browser at the final local code
  (original POS, invoice/A4/thermal, Party, shell, authorization,
  responsive, keyboard, print and all existing Owner browser checks).
- **30/30 PASS**: focused compiled Owner POS + Owner regression + POS
  contract tests including source five breakpoints, light/dark, modal
  focus, active Cash inputs and early unsupported intent rejection.
- **1/1 PASS**: existing real Workerd/D1 Owner browser cash sale after
  customer-input visibility repair. Exactly one confirmed D1 Cash
  receipt, FIFO/Cash Book effects and persisted invoice reload/reprint.
- **4/4 PASS**: existing local Workerd/D1 sale kernel tests (same
  unchanged backend before this final frontend-only input relocation).
- **84/84 PASS** frozen source integrity; docs check PASS; Owner
  compiled frontend build PASS; git diff --check clean.
- The previous GitHub PR head had 2 red jobs. Owner Cash source input
  blocker fixed here. The unrelated Shell 254/256px assertion has a
  coordination comment on #864. **Exact latest pushed head CI remains
  authoritative; local tests do not mean it has merged or deployed.**

## Cross-module merge conflict and M03 Cash journey repair — 2026-11-21

- The only content conflict after merged Shell/Settings/Unit Editor branches
  was scripts/build-owner-frontend.mjs. Its final sequence preserves four
  independent Owner injectors: Party, Settings, Add Product, then POS.
  A new compiled-build contract asserts exactly one Settings, Unit Editor
  and POS controller/style on the combined source.
- GitHub owner-pos-cash failed because legacy mobile Customer tab is
  intentionally hidden by HisabIQ POS; the original name/phone/payment
  fields are directly visible. Original compact-phone test failed RED
  clicking hidden legacy Customer tab. Its GREEN fix clicks a legacy tab
  only if visible, then asserts and fills original input IDs.
  No force click, financial bypass or simulated save.
- Real local Workerd/D1 Product → Supplier → Purchase → POS → Return
  journeys passed **2/2 (desktop and compact phone)**; original
  confirmation, saved invoice, stock, Cash Book, return, tenant isolation.
- Merged POS + Settings + Add Product Chromium **33/33**; compiled build
  POS/Settings/unit contracts **10/10**; all 84 frozen legacy files,
  docs check and Owner frontend build passed.
- No Shop D1 posting kernel, migration SQL, public RPC, Cash Session,
  or legacy source HTML/JS modified by this POS conflict resolution.
- Latest exact-head GitHub CI and human review remain release gates.
