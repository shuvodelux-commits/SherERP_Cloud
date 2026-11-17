# M01 — Products multi-unit / Tiles preview UI (compiled-asset additive, original source preserved)

**Issue:** #564 · **M05 dependency:** merged #566 and optional carton follow-up #578 · **M03:** #22 · **coordination:** #456.
**Base:** `main@76cca6a9b107603cc19a727a6907c7602cddd011`.
**Owner / files:** M01 alone. Add `scripts/patch-m01-products-preview.mjs`, `src/ui/m01-products-preview-controller.mjs`, `tests/m01-products-preview-patch.test.mjs`, `qa/m01-products-preview.spec.mjs`, this plan.
**Protected files not edited:** original frozen `legacy/source/products.html`, `scripts/build-frontend.mjs` (open M01 #570 owns it), `qa/serve-compiled-ui.mjs` (recent M01 #569 ownership), `package.json`, `src/db/**`, migrations, `src/rpc/**`, Worker.
**Deployment status:** independent opt-in compiled-asset enhancement candidate; production build hook is deferred to single M01 owner after #570 merge and #578 review. UI-only preview never creates a Product, D1 record, stock lot, source ID, journal or Cash Session.

## Twelve-sentence implementation overview

1. The original Products modal is an established desktop two-column and mobile single-column workflow, and redesigning it would violate source parity.
2. New inputs should be conditional, so ordinary Single Unit products and Bundle products retain their current layout and handlers.
3. A user selecting Multi-unit may configure a connected outer-unit to Box to Pcs chain with active source unit labels.
4. The preview must use the already-reviewed M05 `previewM05ProductAddForm` calculation rather than duplicate unit factors, prices or opening quantity arithmetic.
5. Tiles mode adds length, width, dimension unit, pieces per Box, nominal or manufacturer coverage, evidence and a choice between Pcs/Box and requested Sqft opening.
6. A Tiles area request must show the actual ceiling-fulfilled Pcs and Sqft, not claim the requested display area was exactly delivered.
7. Each mode will show one compact read-only stock preview such as `2 Box 5 Pcs` or `5 Box 3 Pcs · 512.00 Sqft`.
8. Product rows with reviewed source unit and Tiles metadata may show that same compact text, but unknown metadata must fall back to the original stock-cell display without invented facts.
9. The advanced form must not send a new or changed payload to the old `addProduct` or `updateProduct` RPC because the M03/M04 current writer and source-ID gates remain blocked.
10. The advanced Save button is therefore disabled with a visible explanation, while existing Single Unit and Bundle form behavior remains unchanged.
11. The compiled-output patch copies exactly five reviewed M05 ESM modules and one browser controller into `dist/m05-products/`, preserves the frozen original HTML, and is idempotent.
12. Tests will first prove the missing feature, then validate real Chromium desktop/mobile field reach, keyboard flow, error and read-only behavior, followed by a bounded ui-refine-loop screenshot review before M01 merge.

## UI / visual reference checklist

- Keep original `#prodModal` dialog (560px desktop, full-width mobile), its sticky footer, existing Inter/Noto Sans Bengali fonts, colors, border, spacing, buttons, and Bundle functionality.
- Add a compact `Product units` selection: Single Unit / Multi-unit / Tiles; show one connected Box/Pcs optional Carton chain, price anchor selects and opening split with a visible base-stock preview.
- Tiles conditional section asks actual length/width inches, Box count, pieces per Box, manufacturer coverage and verified evidence only if selected; area-entry quote uses original exact M05 calculator.
- Mark new controls `Preview only`; do not disable or modify existing Save behavior in Single Unit/Bundle, but explicitly disable it in advanced mode until authoritative RPC.
- All new fields have labels and BN helper text. No horizontal scrolling in 1440px or 390px modal; keyboard Tab order, modal scroll and warning text remain reachable.
- Source-data table Stock cell is decorated only if Product row already carries a trusted `unitPreviewSnapshot` with original Product ID, active source units and exact unit/Tiles revision; otherwise fallback unchanged.
- Test-first missing patch module RED, then local unit/fixture GREEN, then full GitHub Actions and M01 owner review; do not merge or claim production Save.
- `ui-refine-loop` uses before/after Chromium screenshots 1440/390, two bounded critique/fix rounds, but do not claim actual workflow automation without installed Claude/Impeccable runtime. Preserve screenshot evidence only if actually committed.
- Build integration is intentionally **not automatic** in this PR because an open M01 dashboard PR edits `scripts/build-frontend.mjs`. The single M01 integrator should add one safe build invocation in a follow-up after that branch merges, then re-run full CI.

**Rollback:** remove only the new opt-in M01 files and any subsequent reviewed compiled-build hook. Existing baseline deploy and production data are unaffected.
