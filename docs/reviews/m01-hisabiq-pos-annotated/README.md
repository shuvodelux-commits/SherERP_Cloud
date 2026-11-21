# HisabIQ POS — Ten Owner-Annotated Interaction Markers

**Workstream:** M01/M06 frontend UI parity, Owner authenticated POS.  
**Reference:** Owner's **21 Nov 2026 annotated POS screenshot**, exact `shuvodelux-commits/hisabiq_ui@e42a00a` — `src/pages/Pos.tsx`, `CartTable.tsx`, `CheckoutPanel.tsx`, `CustomerPicker.tsx`, `src/utils/posMultiUnit.ts` and `reorderCartLines.ts`.  
**State:** An interactive **compiled UI adaptation**, NOT full backend/D1 Store Credit, customer creation, or mixed-unit checkout. Production launch remains gated.
**Dependency:** M01 Sales PR #888 (merged), approved financial design PR #889 (merged); M03 shared posting owner #456, MVP #690. Concurrent Product/Party/Purchase PR #890 touches `scripts/build-owner-frontend.mjs`, which this UI lane deliberately does **not** edit.

## 10 annotation acceptance matrix

| Red marker | Owner-required reference behavior | Current implementation / remaining backend gate |
| --- | --- | --- |
| **1** | `[+]` beside customer select: immediate Quick Add with name/phone, preserve cart | **UI wired** to the original `custOpenAdd_` modal and real callback. **D1 create/role/selection NOT connected** by current Owner dispatcher; persistence/selection end-to-end remains M03 Customer API acceptance |
| **2** | Walk-in default, searchable existing Customer dropdown and explicit selection | **UI wired** with native selected Customer ID and clear/select. **D1 guest paid checkout is not ready**: current Owner Sale SQL requires name and phone, rejects registered IDs. The customer picker clearly labels guest checkout pending backend |
| **3** | Collapsible Invoice Customer Details (name, phone, guardian, address) | **UI wired**, using proxy fields that sync changes to native `#posCustomer*` inputs. Keeps original fields and handlers, no second customer store |
| **4** | Discount amount `৳` / percentage `%` and reactive totals | **UI wired** to native `#posDiscount` with derived integer-paisa rounded amount and original totals recalculation. **Server nonzero discount currently rejected**; no false posting |
| **5** | Add/remove payment sources (+ Add), Cash/Bank wallet selection | Existing source `paymentRows` and Owner capability gate respected; **+ Add is visibly disabled** in cash-only Shop D1 pilot, not a fake split transaction. M06/M08 atomic split/bank posting required |
| **6** | Compound quantities (Box + pcs, Gauge + Gira) | **Not operational** on current Shop D1: original `posState.cart` has one quantity/base unit; required product conversion metadata and atomic multi-unit stock posting are missing. No invented quantities |
| **7** | Inline Add Product search in the cart and Quick Item product cards | **Operational in source UI**, no separate/cart copy: actual product combobox keyboard Enter appends verified POS item; Quick Item tile mutates native cart; existing stock/price authority preserved |
| **8** | Unit switch `Box` / `pcs` / `Gauge` / `Gira` per row | Source-priced current base-unit display rendered; switch is **explicitly disabled** until M05/M06 D1 unit conversion + same-SQL inventory checks are implemented. No client-only conversion |
| **9** | Remaining payment fill; Exact/৳2,000/৳5,000; paid/change/remaining totals | **UI wired** to original `#posAmountReceived` and native total. Exact/Remaining and presets tested. Changes are presentation only until a validated checkout persists |
| **10** | Cart row drag reorder incl. touch/keyboard | **UI wired** to original `posState.cart`, not a second cart. Keyboard ArrowUp/Down tested; pointer drag regression added; touch interaction to verify on actual phone |

## Source architecture, warnings and limits

- `legacy/source/pos.html` is frozen. This PR adds `scripts/patch-hisabiq-pos.mjs`, `src/ui/hisabiq-pos.{js,css}`, one build assembler call, tests, and this review evidence only.
- **No changes to** `src/db`, `migrations`, `src/rpc`, `src/m03-owner-redemption-worker.js`, authentication, Shop D1 binding or finance posting.
- The existing `src/ui/hisabiq/pos-parity.mjs` also decorates POS and **owns native checkout and cart elements** together with `legacy/source/posv2.html`. The first DOM move approach caused a real Chromium `insertBefore` pageerror and compact-width row clipping. Refined to mirror original inputs **without relocating them**, hide only duplicate decorative headings/handles and preserve original product/cash controllers. Retook the Playwright screenshots after fixing. No independent financial state was added.
- **Financial rule:** walk-in may check out without a registered Customer only for full-paid transactions, once the actual Owner D1 guest-sale migration and server authorization are approved. Cash Return to genuine walk-ins remains the original source workflow. Store Credit must require Customer creation or explicit selection, attach the **same immutable invoice** to Customer identity, atomically post a noncash Customer-credit liability, and restore original FIFO quantity **without a Cash Book refund**. Until M03/M07/M08 implement the approved plan, the Store Credit backend remains disabled and cannot be represented as functional.
- **Other acknowledged reference gaps:** Exact pixel-by-pixel parity not achieved: original native POS controls and Shell, sample fixtures, live invoice ID/preview, built-in invoice print and compound/cart pricing vary; current pilot lacks the data schema for screenshot's sample unit conversions. A synthetic screenshot is not a production D1 screenshot.
- Source screenshots are **Playwright compiled browser fixtures** with four synthetic catalog products and three cart rows, not claims of live Shop financial data. The synthetic bootstrap-error toast may be hidden for screenshot-only capture; the underlying failed API is not suppressed in app logic.

## Test evidence

- **RED:** `node --test tests/m01-hisabiq-pos-annotated.test.mjs` failed with missing `scripts/patch-hisabiq-pos.mjs` at test-only commit `3742159c`, then 5/5 GREEN after the compiled-only injector.
- **Browser iteration:** RED 8/8 initially (invalid source-native DOM reparenting, double header, hidden customer modal), corrected through native-input proxy, stable authenticated test fixture, global existing customer modal and source/cart CSS. Afterward 5 responsive widths plus customer selection/details, amount/percentage discount/Remaining, keyboard reorder, Quick Add modal, and source-backed Quick Items all GREEN.
- **Real D1 regression:** `node --test --test-concurrency=2 qa/m03-mvp-cash-return-browser.spec.mjs tests/integration/mvp-first-shop-http-lifecycle-workerd.spec.mjs`: 5/5 PASSED on disposable local real Workerd/Shop D1. Original sale/cash return and Shop-scoped Sales history remain correct; **this does not verify new Store Credit, registered Customer or multi-unit posting**.
- Compiled Owner build, `npm run verify:source` 84/84, `npm run docs:check`, JS syntax, patch guard. Full `npm test` and exact-head GitHub CI/review are release gates, not automatically implied by focused tests.
- Screenshots: `images/320-after.png`, `390-after.png`, `768-after.png`, `1024-after.png`, `1440-after.png`. Reviewer should compare them directly with annotated Owner screenshot at its original viewport and inspect each marker, including disabled states.

## Mandatory next integration sequence

Follow existing merged Superpowers design and plan:
`docs/superpowers/specs/2026-11-21-walkin-pos-customer-store-credit-design.md` and
`docs/superpowers/plans/2026-11-21-walkin-pos-customer-store-credit.md`.

1. M03 creates a **single authoritative Customer/Party Shop D1 API**, SQL-time M04 authorization, idempotent create/read and zero opening balance; then connect POS `[+]` end-to-end.
2. M03/M06 add a versioned guest-sale schema/typed walk-in identity and authenticated full-paid Checkout/registered ID. Full cash return unchanged. Do not fake a phone to satisfy old receipt constraints.
3. M05/M06 add real Shop D1 product unit conversions, verified multi-unit cart serialization, FIFO and price round-trip; M06/M08 add authorized multiple-payment allocations, Cash/Bank and Customer Due for *registered* Customers.
4. M03/M07/M08 add **one atomic Store Credit return**: create/select Customer, immutable invoice attribution, distinct Customer credit liability and restock, same SQL total-return ceiling shared with Cash Return, idempotent replay and cross-Shop denial. No cash movement for Store Credit. Future redemption must be separately tested before advertising.
5. M10/M11: two-Shop real D1 browser + finance reconciliation, auth/revocation, backup/rollback, full CI and explicit production release.

**No live database changes, merges or production flag changes are approved by this UI-only PR.**
