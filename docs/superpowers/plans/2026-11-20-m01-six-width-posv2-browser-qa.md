# M01 — six-width original POS V2 browser regression

**Date:** 2026-11-20  
**Issue:** #733 (follow-up to accepted/closed #25); coordination #456.  
**Branch:** `m01/posv2-six-viewport-qa-20261120`  
**Base:** `main@0a7080d7b6b24d24839e05a1c0846ed669d1df79`  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Why add coverage

M01 already passed original frontend, login/navigation, A4/thermal invoices, print lifecycle, a 375px keyboard POS workflow and 320/768/1280px permission checks (see `docs/reviews/2026-11-17-m01-final-acceptance.md`). The requested specific canonical breakpoints 360, 390, 1024 and 1440px do not have one consolidated, logged-in POS keyboard/UI test. Preserve the existing work; add only this isolated screen/keyboard matrix.

## Exclusive writes / read-only contracts

- **Write:** append one independent browser test to `qa/m01-landscape.spec.mjs`; add this M01-only plan.
- **Read only:** `qa/m01-auth-nav-fixture.mjs`, `qa/serve-compiled-ui.mjs`, `legacy/source/**`, existing print/QA suites.
- **Do not modify:** M03 Control Center `frontend/platform-auth/**`, `src/db/**`, `src/rpc/**`, `src/index.js`, D1 migrations, auth, shared invoice/stock IDs, any posting logic, `package.json` or CI workflows.
- No overlap with PR #729 (M04), #731 (M05), #732 (M08); M02 #730 was merged before branch creation. PR #722 (M03) is merged; its files stay untouched.

## Acceptance

Use real Chromium and the repository's compiled original UI on a private ephemeral localhost server. Intercept only synthetic `login` and `getAppShellData` metadata through the existing fixture. Exercise 320×640, 360×780, 390×844, 768×1024, 1024×768 and 1440×900. On phone widths prove POS V2 cart/customer/payment keyboard Enter tabs, correct ARIA selection, and returning to Cart. On every viewport prove original `#page-pos`, search input remains within viewport, restricted Products-add is **visually** absent, no-match ArrowDown/ArrowUp/Enter does not add cart lines, Escape clears query and retains focus, forbidden Bank is not exposed, session stays logged in, and no sale/payment write RPC was sent. Save six synthetic screenshots under `test-results/m01-browser/`. Ensure the existing M01 invoice/PDF/print suite is still part of the unchanged mandatory browser command.

## Superpowers RED/GREEN interpretation

This is a **baseline parity regression** for already-implemented UI, not a claimed production fix. Do not fabricate a RED failure by withholding fixtures. The new executable assertion is the regression contract: if CI reports a genuine failing case, preserve the failure and notify the owning integrator before changing non-M01 code; if it passes, report baseline-green coverage and no production-code change. Independently inspect exact-head Playwright output, full GitHub checks, screenshots and code diff. No test involving real checkout, real customer data, paid invoice, Workerd accounting or physical printer is implied.

## Test and release sequence

1. Review the new test and run a JS syntax check when execution environment permits.
2. Open draft PR targeting `main` to activate `.github/workflows/m01-browser-qa.yml` and existing full checks.
3. Confirm all six Chromium subtests and the preexisting original invoice/print/auth tests actually ran and passed.
4. Independent `/super qa → /super review`: inspect alerts, permissions, synthetic data and foreign-file overlap.
5. Keep PR unmerged until explicit owner approval, then verify merged code on `main`.

**Risk/rollback:** revert the M01 test addition and this plan. No deployed behavior, private D1, accounts or Workers binding is changed.
