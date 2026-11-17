# M07-UI-R1 — Refine Return search layouts without touching original or shared UI

**Date:** 2026-11-17 · **M07 issue:** #314 · **M01 UI owner:** #25 · **coordination:** #456 · **base:** `main@76cca6a9b107603cc19a727a6907c7602cddd011` · **no M03 dependency for read-only visual review**.

## Overview (12 sentences)
1. This is an isolated refinement of the original Sales Return search card, not a new page or redesign.
2. The user requested the `/ui-refine-loop` workflow and actual Playwright screenshots while M03 completes its shared posting work.
3. The public Super Board skill describes reading the page, screenshotting before, running bounded critiques, screenshotting after, and finishing with a draft PR; we apply its bounded evidence flow without claiming that its Claude Code orchestration is installed here.
4. The frozen original `legacy/source/returns.html` contains invoice and customer search inputs sharing an inline flex row with Find and Clear buttons.
5. The mobile selector in `legacy/source/style.html` targets direct children of `#rtSearchCard`, but the flex row is nested inside `#rtInvoiceSearchPanel` or `#rtCustomerSearchPanel`.
6. At 320px the unfixed field can collapse to a nearly unusable 46px width, which we demonstrated in an isolated source-fragment Playwright screenshot.
7. A tightly scoped CSS proposal targets the nested rows correctly, preserves existing blue/white design tokens and does not change source copy or handlers.
8. Under 540px it places the input on its own row and the Find and Clear buttons on equal columns.
9. It keeps tap targets and inputs at least 44px high and provides a visible keyboard focus ring.
10. An independent Playwright script will render the actual compiled original Returns screen against local test-only inert RPC and generate 320px, 375px and 1440px invoice/customer mode screenshots before and after CSS injection.
11. Because M01 owns preserved frontend changes and M09 works on display parity, this M07 PR adds only a CSS **proposal**, scoped QA automation and a source-selector integrity test; it does not edit `legacy/source`, shared frontend builders, global CSS, Worker or production UI.
12. M01 can accept the proven CSS in a separately reviewed, single-owner integration PR after verifying authentic compiled screenshots and preserving mobile/tablet/desktop parity.

## Files owned in this PR
- `docs/reviews/m07-returns-ui-refine/README.md` (source problem, before/after findings, handoff)
- `docs/reviews/m07-returns-ui-refine/proposal.css` (not imported by Worker or current build)
- `qa/m07-returns-ui-refine-preview.mjs` (standalone Playwright capture script; no RPC writes)
- `tests/m07-returns-ui-refine-contract.test.mjs` (source-structure/selector contract)
- `docs/superpowers/plans/2026-11-17-m07-returns-ui-refine-preview.md` (this plan)

## Non-overlap and security
No edit to `legacy/source/**`, `scripts/build-frontend.mjs`, `scripts/patch-*.mjs`, `package.json`, `.github/workflows/**`, M01/M09 QA, M03 `src/db`/`src/rpc`, stock/finance/posting, preview bindings or migration. No live financial session or private data is used. Playwright captures static source-shaped form only with overlay hidden **in local automation context**, never through a deployed auth bypass. The action is a visual proposal and does not assert a functioning Return endpoint.

## Acceptance criteria
- Source-specific selector targets the actual nested inline-flex rows; customer and invoice modes separately.
- Desktop layout remains single-row; under 540px input spans full search width and buttons become two equal columns.
- Input and buttons have 44px minimum touch targets, keyboard focus ring and no viewport/row clipping at 320/375/390/1440px.
- Native original form IDs, text, event handlers and available refund methods remain unchanged.
- Standalone `node qa/m07-returns-ui-refine-preview.mjs` produces before/after desktop/mobile screenshots and machine-readable clipping metrics after `npm ci && npx playwright install chromium`.
- M07 manifest/source test and full exact-head GitHub CI pass. No screenshot claim is elevated from isolated static fixture to authenticated production verification.
- M01 owner assesses/ports only narrowly approved CSS; do not self-merge into source UI.

**Rollback:** revert this M07-only docs/test QA PR; no deployed behavior or data change.
