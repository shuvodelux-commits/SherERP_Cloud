# M01 accessibility corrections — source-preserving compiled output

**Date:** 17 November 2026  
**Issue:** #558, coordination #456; original M01 baseline issue #25 remains complete.  
**Base:** `main@59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`.  
**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains byte-for-byte frozen.  
**Scope:** `qa/m01-a11y.spec.mjs`, `qa/serve-compiled-ui.mjs`, `scripts/patch-m01-a11y.mjs`, `package.json` (only two build/test scripts), this plan.  
**Protected paths:** no `legacy/source`, `src/db`, `src/rpc`, migrations, public Worker, auth backend, or finance posting changes. The shared build-command change is pending M03 integrator review before merge.

## Implementation overview (12 sentences)

1. The user approved addressing the three verified accessible-UI failures after the Super Board audit was merged as PR #559.
2. Preserve the frozen source tree and keep this a compiled-output-only patch, following the existing reviewed RPC/auth/POS patch pattern.
3. Write real Chromium tests that assert an explicit English document language and a meaningful page title from the compiled shell.
4. Assert the login phone and password inputs are programmatically associated with the visible labels, not named by example placeholders.
5. Exercise the synthetic-only authenticated mobile More dialog on phone and coarse landscape using the original preserved source.
6. Assert focus enters the dialog at open, Tab and Shift+Tab stay within its actionable controls, and Escape restores focus to the More trigger.
7. Run the new test against current `main` and record the RED failures as proof, without using public D1 or private data.
8. Add a deterministic idempotent M01-only patch for the original compiled `<html>`, `<head>`, login label and More navigation function anchors.
9. Connect it to the existing build pipeline and M01 local browser fixture without introducing new frameworks or changing CSS or legacy source.
10. Run focused GREEN tests, source hash verification, the compiled frontend build, the entire M01 Chromium browser suite, and repository node tests.
11. Open one small scoped GitHub PR and require all exact-head CI checks, source/Worker safety validation, and M03 review of the shared `package.json` build step before merge.
12. Only mark #558 completed after the PR is owner-approved, merged to `main`, and the output patch is verified in the actual compiled build.

## TDD ledger

- RED: failing Chromium accessible-name/language/title and mobile More focus tests against unmodified compiled UI.
- GREEN: compiled HTML-only M01 patch and test harness wired, with no original GAS source hash drift.
- REFACTOR: minimal anchor/idempotence guards, no unrelated changes.
- Release guard: `/api/rpc` remains fail closed and auth/party/stock/payment/ledger semantics unchanged.
- Rollback: revert compiled patch import/build command + M01 test file. No D1 migrations or data rollback.
