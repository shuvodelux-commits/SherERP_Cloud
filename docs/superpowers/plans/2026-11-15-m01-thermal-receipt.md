# Superpowers plan — M01 original thermal receipt regression

**Scope:** M01 frontend QA only. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. **Inspect:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 (nonimpact), preserved `renderInvoiceHtmlThermal_`, receipt-specific CSS and current M01 Playwright fixture.
2. **Acceptance-first tests:** Add Chromium cases to `qa/m01-browser.spec.mjs` for 58mm and 80mm using *original* renderer; assert receipt DOM, applied payment/change, exact physical PDF width, one-page outcome and draft marker. Do not implement any new receipt generator or a fake RPC.
3. **Observe RED/GREEN honestly:** Run test-only commit in GitHub Actions. If existing source passes, document first-run GREEN with no implementation; do not fabricate a failing test. If it fails, preserve the observed issue; propose a separate, approved compatibility fix rather than altering frozen source in this branch.
4. **Verify:** Require exact-head Foundation Node + source verification/build, M01 real Chromium, and all affected PR-only workflows. Review screenshots and synthetic PDFs; record limits.
5. **PR:** Review file/RPC/table inventory; draft GitHub PR, unmerged until owner review and CI is clear.

**Changed paths:** `qa/m01-browser.spec.mjs` and two new plan/design markdowns. **Backend/Worker:** untouched. **RPC/DB/Party/ledger/migrations/Cloudflare:** none. **Original source HTML/CSS/JS:** unchanged. **Rollback:** revert PR.
