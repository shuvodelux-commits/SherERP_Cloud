# M01 Add Product — HisabIQ-style multiple units and area coverage

**Reference:** [`hisabiq_ui` at `e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`](https://github.com/shuvodelux-commits/hisabiq_ui/blob/e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/src/components/products/form/AdvancedStockPanel.tsx), specifically `AdvancedStockPanel.tsx`, `OtherOptionsPanel.tsx`, `useAddProductForm.ts`, `src/utils/productDraft.ts` and the global Geist/Hind Siliguri product-form design. **Target:** compiled, authenticated **Owner** Add Product overlay in SherERP Cloud, built from unchanged original legacy HTML. No Product Table, POS, Party UI or backend schema changed.

## Product owner interaction

1. Leave **Multiple units** off for a normal single-unit Product. The original Add Product fields and server-authorized single-unit Save path remain unchanged.
2. Choose the real **physical stock unit** (for example `Pcs`) from the original Unit field. Turn on **Multiple units / একাধিক একক**. The new, compact joined equation appears with a managed larger-unit dropdown: **1 Box = 15 Pcs**. If the smallest stock unit is `Box`, the editor suggests a distinct larger unit like `Carton` instead of `Box` again. It does not create managed Unit records or treat inactive masters as approved.
3. Optional **Add another unit** adds a Carton-to-Box relationship such as **1 Carton = 12 Box**. It remains an editable *physical quantity* relationship mirrored to the existing M05 nonposting preview. The Add Product UI does not write it to D1.
4. The separately labelled **Area measurement / স্কয়ার ফুটের হিসাব** is opt-in. With **1 Pcs = 0.65 Sqft**, calculate **1 Box = 9.75 Sqft** while physical inventory remains in whole Pcs. `Sqft` is **excluded from the physical pack dropdown** to avoid a false Pcs-as-Sqft stock conversion. Users must enter actual area evidence for their product where appropriate; there is no invented manufacturer-verified claim.
5. Opening preview of **2 Box + 5 Pcs** shows **35 Pcs stock** and **22.75 Sqft coverage**. For **1 Carton + 2 Box + 5 Pcs** at 12 Box/Carton, 15 Pcs/Box, it shows **215 Pcs** and **139.75 Sqft**. Values are calculated with fixed 4-decimal integer arithmetic rather than floating-point approximation.
6. Original Purchase Price and Selling Price remain physically present. The new **per-unit selectors** mirror the existing M05 source read-only price-unit controls; independent unit-specific overrides and writable unit-conversion snapshots are **not** implemented as backend capabilities.
7. The old fixed Box/Pcs preview remains in DOM and runs its original M05 calculations but is **hidden when the new editor is installed**, so it is not shown twice. An error explains invalid numeric input instead of displaying stale coverage.
8. **Safe guard:** activating multi-unit mode deliberately disables **Save Product**; it is a **preview only** until the approved authenticated D1 product contract supports versioned unit conversions and coverage. An existing product's unit relationships remain locked from editing; a Bundle hides this Stock editor. No fake Save, stock movement, RPC, persistence or finance authorization is introduced.

## Test matrix and screenshots

`qa/m01-hisabiq-add-product-unit-editor.spec.mjs` builds the real compiled Owner shell, uses a synthetic *nonposting* Owner session/catalog fixture, and saves each viewport's before/after and scrolled preview from the same shell. For before shots, it removes **only** the candidate editor's inline style and script from the compiled HTML, not other features. Tests assert actual innerText, input values, role=switch, source M05 field mirroring, disabled unsafe save, outer unit, Bundle hiding, existing-product read-only, errors and viewport geometry.

| Viewport | Original Add Product | Multiple units enabled | Scrolled live preview |
| --- | --- | --- | --- |
| 320px | [before](images/320-before.png) | [after](images/320-after.png) | [preview](images/320-preview.png) |
| 390px | [before](images/390-before.png) | [after](images/390-after.png) | [preview](images/390-preview.png) |
| 768px | [before](images/768-before.png) | [after](images/768-after.png) | [preview](images/768-preview.png) |
| 1024px | [before](images/1024-before.png) | [after](images/1024-after.png) | [preview](images/1024-preview.png) |
| 1440px | [before](images/1440-before.png) | [after](images/1440-after.png) | [preview](images/1440-preview.png) |

The standalone [390px editor](images/390-editor.png) highlights compact labels and 36px input geometry. Screenshots are **synthetic authenticated Owner previews, not a live D1 multi-unit product creation**.

## Visual refinement / TDD notes

- **RED → GREEN 1:** missing contract/model module; exact decimal math and managed-unit validation implemented with TDD.
- **RED → GREEN 2:** screenshot review showed duplicate original fixed Box/Pcs controls beneath new editor; a 320px Chromium visibility assertion failed before scoped CSS hid them. M05 source data and original handlers remain unchanged.
- **RED → GREEN 3:** selecting a base Unit of `Box` still offered `Sqft` as a pack; Chromium rejected that option and the editor now filters area out of physical pack selectors, selecting valid `Carton` instead.
- First 1024px browser run saw 21px **document** overflow, traced to the independently merged Shell topbar. Add Product panel itself was bounded (`editorLeft=92`, `editorRight=932` within 1024px); product-specific assertions now check its own viewport geometry, without modifying another workstream's Shell CSS.
- Design is scoped to `#prodModal .hapu-editor`, reference token-compatible, uses Geist and Hind Siliguri without monospaced numbers, reachable 36px controls, proportional typography, focus-visible rings, touch-width rows and reduced-motion-aware toggle. Legacy runtime markup is not redesigned globally.
- The literal `/ui-refine-skill` is not installed in this environment: this round instead used pinned HisabIQ implementation reference, real Chromium screenshots at five viewports and iterative visual QA; **do not claim the named skill executed**.

## Verification and independent release gate

Focused TDD/Chromium/M03 single-unit D1 smoke on the branch: **51/51 pass after rebase onto merged Settings PR #871**, including `qa/m03-clean-shop-product-form.spec.mjs` with pinned Wrangler `4.161.0` installed only in the worktree. The full M01 Chromium browser suite passed **171/171** on the original feature branch; the rebase onto merged Settings PR #871 was followed by **51/51 focused tests** including the new Settings Chromium tests, and five-width before/after screenshots were recaptured on the rebased shell. A broader local `npm test -- --test-concurrency=4` was started but **could not be verified to completion**: one unrelated Node worker entered uninterruptible I/O after the first 328 reported tests, so the isolated runner was stopped rather than misreporting a full green suite. Exact-head GitHub CI remains a separate gate.

**Critical difference from `hisabiq_ui`:** the reference supports multiple physical unit levels, independent per-unit prices, edit and actual save. SherERP's current Product master does **not** support that complete unit-chain/area D1 save. This PR is a verified *frontend UX + nonposting calculation preview*, **not** fully functional multi-unit Product creation. A future M03/M05/M04 authorized backend PR needs reviewed unit profile versioning, physical/coverage separation, tenant-owned unit IDs, exact price/stock snapshots, historical migration rules and atomic D1 commit tests before the Save button can be enabled. No production D1 migrations, source modifications, public RPC bindings, release or auto-merge occur here.
