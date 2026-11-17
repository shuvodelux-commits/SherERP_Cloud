# M07 — Compiled Returns Search Clear wrapper refinement (source-preserving)

**Workstream:** M07 Returns & Corrections, **issue:** #314, central board #456. **Integration owner:** M01 for production CSS; M03 exclusively owns D1/RPC/transaction reversal. **Base main:** `94534c5cdc39f9a482cecbb6cff25ef36159661a` after PRs #565 and #584 merged to main. **Source baseline:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Scope:** isolated M07 proposal + Playwright proof only; no source, public UI or financial posting.

## 15-sentence implementation overview

1. The Returns page must preserve the existing Invoice and Customer search fields and event handlers.
2. M07 proposal PR #584 selected the nested original search rows but only targeted the input element for the mobile grid span.
3. The compiled frontend's M01 global search-clear enhancement wraps that input in a `.erp-search-clear-field` span.
4. Consequently the span, not the input, becomes the actual child of the proposed CSS grid.
5. At 320px the unmodified proposal leaves the search field approximately 129px wide instead of occupying the 266px row.
6. The original Playwright script also counts an initially hidden inner clear button as a third action.
7. Its compiled-UI 320px assertion failed on the real original application shell when executed through the local RPC-disabled fixture on the connected CachyOS machine.
8. This fix will span the actual wrapper across both mobile grid columns.
9. The existing input will continue to fill the wrapper without overriding M01 clear-search behavior.
10. Desktop layout will retain the source search field with the two original Find/Clear buttons.
11. The Playwright metrics will inspect only **direct child action buttons** of each search row.
12. The assertion will require exactly two visible 44px touch actions in each search mode.
13. The browser script will capture both modes at 320px, 375px and 1440px before and after injected CSS.
14. No client permission, Cash Session, D1 lot, Party balance, posted Return, original HTML handler or public RPC will be changed.
15. M01 must separately approve and integrate any production CSS once this preview is proven; a passing preview is not real Return posting.

## Red → Green acceptance

**RED 1 (real Chromium on immutable main):** `node qa/m07-returns-ui-refine-preview.mjs`, using system Chromium + pinned clone, failed `AssertionError: refinement must not clip at 320`. Root-cause browser DOM showed the direct child `span.erp-search-clear-field` 129px wide; the original Find button occupied the other column while original Clear fell to the second row; hidden nested clear was incorrectly counted by QA.
**RED 2 (Github test-first):** extend `tests/m07-returns-ui-refine-contract.test.mjs` to demand wrapper-aware mobile grid spanning and direct-child button selection; run GitHub CI on test-only head and capture expected failure.
**GREEN:** change only `docs/reviews/m07-returns-ui-refine/proposal.css` + `qa/m07-returns-ui-refine-preview.mjs`; rerun Node, browser screenshots, and full exact-head GitHub CI.

**Exclusive M07 ownership:** `docs/superpowers/plans/2026-11-17-m07-returns-wrapper-qa.md`, existing M07 proposal CSS, existing M07 preview script, existing M07 contract test. **Read/write:** test, docs and **undeployed CSS proposal only**. **No changes to** `legacy/source/**`, `scripts/patch-*`, shared `src/db/**`, migrations, `src/rpc/**`, original operational frontend, M01-owned QA or M03 posting files.

**Gates:** 12 captures, zero refined clipping; 320/375 input spans full row, equal Find/Clear controls >=44px; focus indicators, intact Returns checkout/refund controls; no live transactions, auth or real D1 mutation. **Rollback:** revert this M07-only four-file PR. **Merge order:** main after all checks and review; M01 separate production CSS PR when approved.
