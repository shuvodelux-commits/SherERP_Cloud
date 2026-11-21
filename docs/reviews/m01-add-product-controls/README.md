# M01 — Add Product dropdown geometry and misleading Owner toast correction

**User screenshot / previous UI:** [390px prior multi-unit screenshot](../m01-hisabiq-add-product/images/390-preview.png). **Source:** `main@766c0d2e` with Add Product editor already merged in #872. **Visual authority:** HisabIQ `AdvancedStockPanel`, `docs/design-system/HISABIQ_SHERERP.md`: control height 36px, radius 6px, proportional Geist/Hind Siliguri, two equally sized editable equation tracks, phone 320/390, tablet 768, desktop 1024/1440. **Scope:** authenticated Owner Add Product compiled form and its screenshot-test fixture. No new product permission or D1 write.

## Root-cause analysis

The red toast in the previous user screenshot is a **synthetic Playwright Owner-shell fixture artifact**: that suite opens the original Add Product modal with nonposting data and intentionally does not establish a real Shop D1 session. The compiled Owner's fallback for **any unsupported RPC function name** wrongly returned `Shop business data is not connected yet.`, which sounded like a diagnosis of the entire business database. The fallback now says `This ERP action is not available yet.`. It still rejects the call and never fakes a successful response or a connected D1. Real auth, product-read, D1 failure and permission errors remain visible and unchanged.

The original ERP enhances every `<select>` with a visible `.touch-select-trigger` button. On phones, that button has a **44px** minimum height, while the new unit numeric fields use **36px**. The Product Name field was **46px** and `Manage` actions **44px** in the initial 320px Chromium measurements. The fixed desktop equation grid also used unequal **1.4fr / 1fr** editable columns. That mismatched dropdown/quantity border line in the annotated user screenshot.

## Scoped correction

- Styles the **actual visible trigger**, not just the visually hidden `<select>`: 36px height, 6px radius, consistent width, caret and focus ring. Extends the same geometry to existing Add Product fields and paired Manage buttons, not other ERP screens.
- Uses equal-width `1fr / 1fr` editable tracks for Box/Quantity and Carton/Quantity equations, respecting the equation's `1`, `=` and unit-suffix columns. Opening and price unit rows remain two equal columns. Controls fit within 320px without document horizontal overflow.
- Keeps all real Owner connection/authorization failure states fail-closed. A toast is still shown on error, but in multi-unit Add Product it sits **above** the sticky Save/Cancel footer rather than covering those buttons.
- Synthetic Playwright screenshots now wait for their existing transient 3.2s toast to expire naturally. Their top status message explicitly says `UI fixture — no live Shop D1 connection was tested.`, **test-only**; the real Owner notice has not been hidden or rewritten.
- Mobile Cancel and the correctly disabled **Save unavailable** action remain single-line at 320px. Multi-unit Save stays disabled because the authenticated Owner D1 Product Save contract does not yet store multi-level conversions or area; see #314. This UI PR does not connect or migrate a real Shop D1, authorize the advanced Save or bypass any release gate.

## Actual browser evidence

| Viewport | Verification screenshot |
| --- | --- |
| 320px phone | [Updated form, equal fields and footer](images/320-after.png) |
| 390px phone | [Updated form](images/390-after.png), [scrolled equations and results without transient fixture toast](images/390-preview.png) |
| 768px tablet | [Updated form](images/768-after.png) |
| 1024px desktop | Passed geometry+form Playwright assertions (screen captured by test, not duplicated here) |
| 1440px desktop | [Scrolldown result with explicitly labeled synthetic fixture](images/1440-preview.png) |

**TDD evidence:** Before implementation, Chromium failed at `320px prodName: 36px visible control required; found 46`, `320px prodManageUnitsBtn: 36px visible control required; found 44`, and the unsupported RPC returned the misleading blanket Shop-data error. The new tests also verify the exact visible custom trigger (not a hidden native input), matching top/bottom and widths at 320/390/1440, paired Manage buttons, and that a visible error toast never obscures Save/Cancel.

**Focused acceptance:** 41/41 Chromium/Node/M05 calculation and real-local-Workerd/D1 single-unit Save tests passed. **Full M01 Chromium suite** (exact candidate head `83d36bcf`): **181/181 passed**, zero failures, including new geometry/toast assertions, POS, authentication, print, Party, Supplier and Owner regression flows. This **does not** prove that a production hosted Shop D1 is connected or that multi-unit Save works. Original frozen source, auth, price/stock posting and historical snapshots are not altered. `/ui-refine-skill` runtime was not available on this PC; pinned source, actual 5-breakpoint Chromium UI and bounded screenshot comparison were used instead; the named skill gate remains unverified.
