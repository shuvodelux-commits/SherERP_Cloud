# M01 — source-faithful POS V2 Draft Invoice dialog browser regression

**Date:** 2026-11-20. **Issue:** #743; completed predecessors #25/#733. **Coordination:** #456. **Branch:** `m01/posv2-draft-dialog-qa-20261120`. **Base:** `f5736dbe0cf5ea930222ac43dfb6a8e2e9db290e`. **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Implementation overview

1. M01 original frontend acceptance and six-width POS V2 keyboard matrix are already merged; this test is a new independent gap.
2. The original `legacy/source/posv2.html` contains a lazily created Draft Invoices dialog; preserve its behavior rather than replacing it.
3. Draft list loading calls `getSalesDraftList` through `serverCall`, a dependency not enabled as public production RPC.
4. Use only existing `serveCompiledUi` and `installM01SyntheticNavigation` helpers to render the actual preserved frontend.
5. Synthetic authentication is limited to Clerk POS view, not an authorization assertion about live server sessions.
6. Intercept only `getSalesDraftList` with test-local empty data and a controlled failure, never enable a real draft write.
7. Exercise keyboard Enter on the actual Drafts button, focused search and source empty state on 390px phone and 1280px desktop.
8. Exercise Refresh plus both original close controls and verify that the modal can reopen without duplicate dialogs.
9. On failed draft-list loading, verify the modal stays closed and no accidental sale, draft or payment submission occurs.
10. Capture synthetic screenshot evidence using the existing M01 artifact directory and leave the other invoice/PDF suites unchanged.
11. Any original UI behavioral failure is recorded as a real RED finding and handed off to the M03/M01 UI integrator; do not alter frozen source without ownership.
12. Run existing exact-head M01 Chromium and full GitHub CI, perform a scoped static review and request independent review before human merge.

## Ownership and acceptance

**Exact M01-owned write files:** `qa/m01-landscape.spec.mjs` and new `docs/superpowers/plans/2026-11-20-m01-posv2-drafts-browser-regression.md`. **Read-only:** `qa/serve-compiled-ui.mjs`, `qa/m01-auth-nav-fixture.mjs`, `legacy/source/**`, current `AGENTS.md` and parallel rules. **Forbidden:** M03 Control Center UI, `src/db/**`, migrations, `src/rpc/**`, `src/index.js`, financial posting, auth, root `package.json`, shared CI and original Mohim_ERP.

**TDD:** Add test-first browser contract. This is testing already-existing source behavior, so baseline GREEN is acceptable; do not fake RED by breaking the fixture. Failure is an actual reproducible defect with independent source-owner review, not permission to edit the shared frontend. No real remote D1 data, invoice, sale, draft write or deployment. Production backend integration remains blocked.

**Review and merge:** 2 M01-owned files only; exact-head full CI and Chromium evidence; independent reviewer; owner-approved merge into `main`. On regressions, retain drafts and report. Revert this test block and plan for rollback.
