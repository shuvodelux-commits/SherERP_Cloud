# M01 — original POS V2 keyboard product-selection and cart regression

**Date:** 20 November 2026  
**Issue:** #747; completed preceding M01 #25, #733, #743. **Coordination:** #456.  
**Branch:** `m01/posv2-keyboard-cart-qa-20261120` based on `main@a4995ed69616ab1d3e05a675bc19d39414f94878`.  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Superpowers implementation overview (12 sentences)

1. M01's previous original browser, POS navigation, six-width responsive and Drafts dialog tests have already merged.
2. The remaining independent interaction gap is a real selection from the original POS V2 popup followed by cart editing and removal.
3. The pinned original `pos.html` and `posv2.html` render product search, cart entry, quantities, line rows and Clear Cart using existing client handlers.
4. The live Worker public RPC is intentionally not connected to real product/financial posting services.
5. Therefore this test will seed only two clearly synthetic Standard products into ephemeral in-browser `posState`, indexing them through the original `smartIndexProducts_` helper.
6. It will exercise actual Chromium keyboard Enter, the original `#posCartProductPopup`, active cart Qty input and Enter-to-finish flow.
7. It will check duplicate rejection, a second selected product, line unit labels, rendered line quantity, removal and Clear Cart.
8. The experiment will run on 390px phone and 1280px desktop and collect screenshots under the existing M01 evidence path.
9. No mock success will be returned for sale, purchase, draft or ledger writes, and the test will assert no financial RPC.
10. Source multi-unit/Tiles Box/Pcs/Sqft production cart is NOT yet integrated: candidate read-only preview tests must not be misrepresented as operational sales.
11. The two exclusive write files are a new M01 plan and one appended test block in `qa/m01-landscape.spec.mjs`, with no modifications to original source or other workstreams.
12. Exact-head Chromium, full GitHub CI and independent Super QA/Review will gate any human-approved merge.

## Ownership and tests

Write: `qa/m01-landscape.spec.mjs` (append only) and `docs/superpowers/plans/2026-11-20-m01-posv2-product-cart-interaction.md` (new only). Read only: `qa/m01-auth-nav-fixture.mjs`, `qa/serve-compiled-ui.mjs`, `legacy/source/**`, source manifest, other M01 tests.

Do not touch M03 Control Center UI, `frontend/**`, `src/db/**`, `src/rpc/**`, `src/index.js`, migrations, platform auth, transaction kernel, production data, source repository, npm scripts, CI or other workstreams' reservations.

**RED/GREEN:** test-first parity extension for pre-existing behavior. Baseline-green is acceptable, artificial RED is not. If real Chromium fails, keep failing evidence and diagnose whether assertion/fixture or original UI defect; for foreign files request integrator ownership. Complete `/super build → /super qa → /super review` and require all exact-head GitHub checks. No auto-merge or deployment.

**Rollback:** delete this M01 test block and plan only; no runtime behavior changes.
