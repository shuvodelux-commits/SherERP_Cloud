# M01 — Reports Print freshness, compiled-only independent integration candidate

**Workstream:** M01 frontend/UI QA · **Issue:** #431 (M09 handoff), #25 (M01 original UI), coordination #456.
**Base main:** `ff8582d810ecfba8fcc8ed303687cfd6a50dfbf2`. **Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Dependencies:** M09 merged #593 browser proposal and `src/modules/m09-report-control-state.js`; M03 alone controls common frontend-build activation, shared D1/RPC, auth/write infrastructure.
**Own files:** new `scripts/patch-m01-report-print-safety.mjs`, `src/ui/m01-report-print-controller.js`, `tests/m01-report-print-safety.test.mjs`, `qa/m01-report-print-safety.spec.mjs`, and this plan. Existing M01 dashboard PR #622 owns `qa/m01-browser.spec.mjs`/`src/ui/hisabiq-dashboard.html`; no overlap.
**Write scope:** isolated compiled-only proposal, not installed by the production `package.json` build. No `legacy/source/**`, `src/db/**`, `migrations/**`, `src/rpc/**`, Worker or posting changes.

## Twelve-sentence overview

1. Preserve the existing Reports layout, all six tabs, source loaders and printing CSS.
2. Confirm that the frozen original Print button currently permits printing before a successful active report load.
3. Establish test-first proof against that current compiled report function before changing it.
4. Add a deterministic, source-anchored compiler patch that fails closed on missing or duplicate source blocks.
5. The patch will add a small M01-only controller before the original Reports script and wrap only `rptRunActive_` in the compiled output.
6. Each report-load attempt receives an identity-, date- and generation-scoped ticket.
7. Only completion of the latest matching attempt marks a report printable.
8. A rejected, pending, superseded, stale-date or different-session result cannot enable Print.
9. Date edits invalidate all period reports, while Stock and Balance Sheet keep snapshot semantics.
10. Print remains visibly disabled and a capture-phase guard preserves the existing print listener from stale calls.
11. Run Node source-fidelity tests and an independent real-browser synthetic fixture without adding any public financial RPC.
12. Keep the PR unmerged from production build integration until M03 approves the common build hook and full exact-head CI, browser artifacts, peer review and final M01 QA pass.

## RED→GREEN acceptance

- **RED:** Baseline frozen HTML still contains unsafe Print and unguarded `rptRunActive_`; new test fails against missing source-anchored patch.
- **GREEN:** precise compiled-only replacement, deterministic/idempotent install, actual successful-load tickets, failed/pending/date/session guarding, and snapshot report eligibility.
- **Test safety:** synthetic report fixtures only; no real credentials, financial data, Worker D1 writes or production authorization.
- **Build gate:** do not modify `package.json` or the shared build orchestration without an explicit M03-owned reviewed integration decision on #456.
- **Rollback:** remove this isolated patch/controller/test proposal. Original Apps Script and deployed Worker remain unchanged.
