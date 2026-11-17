# M07 Returns search — Playwright visual refinement proposal

**Status:** Visual QA proposal only. Not deployed or merged into the actual original UI. **UI integration owner:** M01 (#25); **return contracts:** M07 (#314); **coordination:** #456. Source: `legacy/source/returns.html` + `legacy/source/style.html` on `main@76cca6a9b107603cc19a727a6907c7602cddd011`.

## Issue isolated by source audit

The original New Return page has two search modes, Invoice and Customer. Both place a search input, a Find button, and a Clear button in an inline-flex row **nested** in `#rtInvoiceSearchPanel` / `#rtCustomerSearchPanel`. The mobile CSS selector `#page-returns #rtSearchCard > div[style*="display:flex"]` targets a direct child of `#rtSearchCard` and misses both rows. At 320px, the flex input can shrink so far that the invoice/phone or customer hint is invisible. This is not horizontal viewport overflow: it is *search-field compression*, so a test that only checks page scroll width would miss it.

## Bounded refine loop: diagnose → small CSS → screenshot check

The proposed CSS keeps the original Inter/Noto Bengali, blue/white palette and existing card/button style; it makes the input full row at mobile width and groups two actions in equal-width columns. On desktop the row remains search + Find + Clear. A focus-visible outline and 44px minimum input/action height improve keyboard and touch behavior without modifying labels, IDs or event handlers.

**Screenshots already inspected (original PR #584):** isolated static source-fragment Playwright captures at **320px, 375px and 1440px**, Invoice and Customer, with both before/after states, produced with Python Playwright and Chromium. The source-fragment captures used the real first search-card markup and measured style tokens from the frozen original files, but **they are not screenshots of an authenticated ERP or the complete compiled page**. They show the issue and proposed visual effect only; do not use them to certify real browser behavior. The user-visible comparison image was generated as `/mnt/data/m07-ui-refine/playwright-before-after.png` in the conversation runtime and intentionally is not claimed as a GitHub PR image artifact.

**Follow-up compiled UI evidence:** [17 Nov 2026 browser results](compiled-qa-2026-11-17.md) from M07 corrective proposal PR #592 identify the M01 global search-clear wrapper and prove the 320/375px refined search field occupies its full row in all four mobile cases. The first merged proposal failed on the complete compiled page; the follow-up fixed the **undeployed CSS preview and QA script only**. Production CSS integration, authentic Returns and final M01 review remain pending.

**Full compiled original UI screenshot procedure** (after checking out this PR):
```bash
npm ci
npx playwright install chromium
node qa/m07-returns-ui-refine-preview.mjs
```
The standalone script uses the project's existing `serveCompiledUi` local-only, fail-closed RPC fixture and renders `#page-returns` in Playwright. It captures both search modes at **320, 375, 1440px** before and after injecting **only** `proposal.css` into the test page. It writes 12 screenshots and `test-results/m07-returns-ui-refine/metrics.json`. On its refined pass, it asserts the entire input spans the mobile row, equal Find/Clear button width, 44px targets and no clipping. It never calls a real Return RPC or alters auth on a deployed Worker. If a screenshot shows a new defect, update this proposal or reject it; do not silently adjust the preserved GAS source outside M01 ownership.

## Evidence and acceptance

| Viewport | Mode | Baseline observation | Proposed change | Verification status |
| --- | --- | --- | --- | --- |
| 320px | Customer | Search input compresses to only a few visible characters | Full-width input, two equal actions | Playwright **source-fragment** screenshot; compiled UI pending |
| 375px | Invoice | Invoice/phone hint truncated by 3-button row | Full-width hint and controls | Playwright **source-fragment** screenshot; compiled UI pending |
| 1440px | Both | Existing horizontal row is usable | Preserve desktop appearance | Playwright **source-fragment** screenshot; compiled UI pending |
| Complete app | Both | Protected shell requires trusted authentication | Local-only test DOM reveal, no real login | Compiled-page script executed with follow-up CSS on local RPC-disabled fixture (12 captures, 0 regression); M01 integration still pending |

**Known limitations:** Static UI fixture measurements do not prove full dashboard, Return Cart, hardware fonts, RTL/Bangla wrapping, actual date/calendar, modal behavior, authenticated navigation or real Business D1 parity. The public Worker still denies Return/RPC actions and the source remains unmodified. M01 should inspect the 12 compiled-page Playwright screenshots and run existing M01 browser a11y/print tests before separately integrating the CSS. M07/M03 continue to own source ledger safeguards, not visual frontend integration.

## Integration request to M01

Apply the CSS selectors from [proposal.css](proposal.css) through M01's reviewed frontend-patch mechanism **only after** the compiled-page screenshots and accessibility checks pass and the M01 owner has confirmed no parallel edits to the same source/build files. Do not replace or delete old Return functions, change their labels, add payment handlers, enable unauthenticated content, or touch `src/db`, `src/rpc`, `CashSession`, `Worker` configuration or source GAS. A green M07 proposal PR is not evidence that the production Returns page has been refined.

**Risk:** Low for isolated CSS preview; production integration remains separate. **Rollback:** revert the CSS proposal and preview-only QA/docs.
