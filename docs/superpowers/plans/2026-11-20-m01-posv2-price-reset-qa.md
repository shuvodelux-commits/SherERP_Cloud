# M01 — original POS V2 FIFO-price display and manual-reset Chromium QA

**Date:** 2026-11-20  
**Issue:** #760 (after merged #755); coordination #456  
**Base:** `main@8aaad241e920fc3ff4df7bd21f3f402b4ad3301d`  
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`  
**Branch:** `m01/posv2-auto-manual-price-qa-20261120`

## /super build — implementation overview (12 sentences)

1. M01 verified original HTML/CSS/JS browser navigation, responsive POS tabs, print, product search, cart entry and row drag on prior merged PRs.
2. The next uncovered client behavior is the source POS V2 automatic lot-price display, manual unit-price override and reset-to-lot cycle.
3. The original `posComputeAutoPricing_`, `posApplyAutomaticPricing_`, `posApplyManualLineTotal_` and `posRenderCart_` functions remain unmodified.
4. The preserved cart computes a two-decimal line total from a list of source lot selling prices and separately rounds the displayed unit-average price.
5. Testing those two outputs prevents accidental multiplication of the displayed rounded average instead of preservation of the exact source lot sum.
6. The test seeds one clearly synthetic standard product only into a Chromium page's original `posState`.
7. The synthetic lot list is two pieces at ৳19.99 and three at ৳24.99 with an explicit fallback selling price of ৳30.
8. Actual original Qty and Price fields are operated through real Chromium keyboard and input events at 390px phone and 1280px desktop.
9. Four units must display an automatic line total of ৳89.96 while a manual ৳22.50 override yields ৳90.00.
10. Increasing quantity to five while manual must preserve ৳22.50 per unit and yield ৳112.50 before Reset returns the exact lot sum ৳114.95.
11. The same test checks subtotal/grand-total display, absence of duplicate Reset buttons, screenshot evidence and zero financial write RPC calls.
12. This is isolated frontend presentation/regression QA, not proof of authoritative D1 FIFO stock depletion, ledger posting, decimal database rounding or real checkout.

## Ownership, TDD and gates

**Exclusive M01 writes:** append only `qa/m01-landscape.spec.mjs` and add this plan `docs/superpowers/plans/2026-11-20-m01-posv2-price-reset-qa.md`. **Read-only dependencies:** existing fixture, compiled UI server, frozen `legacy/source/pos.html`/`posv2.html` and repo AGENTS/parallel docs.

No changes to M03 Control Center, `src/db/**`, `src/rpc/**`, `src/index.js`, `frontend/**`, any migration, auth, M05 lot/purchase, M06 sales, M08 money, Cloudflare config or root build scripts.

**Test-first:** add genuine browser regression tests. Already implemented source behavior can give baseline GREEN; never manufacture RED. Real unexpected RED requires evidence and a source-owner handoff for non-M01 code, with no independent source/UI redesign. Full exact-head CI and original Chromium suites plus independent QA/review and explicit human-approved merge. Keep PR draft. No production D1 use.

**Rollback:** revert this new test block and plan only; no runtime behavior changed.
